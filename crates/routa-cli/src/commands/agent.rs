//! `routa agent` — Agent management commands.

use std::sync::Arc;

use dialoguer::{theme::ColorfulTheme, Input, Select};
use routa_core::orchestration::{OrchestratorConfig, RoutaOrchestrator, SpecialistConfig};
use routa_core::rpc::RpcRouter;
use routa_core::state::AppState;
use routa_core::workflow::specialist::SpecialistLoader;

use super::print_json;

pub async fn list(state: &AppState, workspace_id: &str) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "agents.list",
            "params": { "workspaceId": workspace_id }
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn create(
    state: &AppState,
    name: &str,
    role: &str,
    workspace_id: &str,
    parent_id: Option<&str>,
) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let mut params = serde_json::json!({
        "name": name,
        "role": role,
        "workspaceId": workspace_id
    });
    if let Some(pid) = parent_id {
        params["parentId"] = serde_json::json!(pid);
    }
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "agents.create",
            "params": params
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn status(state: &AppState, agent_id: &str) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "agents.get",
            "params": { "id": agent_id }
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn summary(state: &AppState, agent_id: &str) -> Result<(), String> {
    // Agent summary uses agents.get since there's no separate summary RPC method
    let router = RpcRouter::new(state.clone());
    let response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "agents.get",
            "params": { "id": agent_id }
        }))
        .await;
    print_json(&response);
    Ok(())
}

pub async fn run(
    state: &AppState,
    specialist: Option<&str>,
    prompt: Option<&str>,
    workspace_id: &str,
    provider: &str,
    specialist_dir: Option<&str>,
) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let specialists = load_specialists(specialist_dir);
    if specialists.is_empty() {
        return Err(
            "No specialists available. Add files under specialists/ or resources/specialists/."
                .to_string(),
        );
    }

    let (prompt_specialist, prompt_remainder) = parse_prompt_mention(prompt);
    let selected_specialist = if let Some(id) = specialist.or(prompt_specialist.as_deref()) {
        find_specialist(&specialists, id).ok_or_else(|| format!("Unknown specialist: {}", id))?
    } else {
        select_specialist(&specialists)?
    };

    let user_prompt = match prompt_remainder.or(prompt.map(|value| value.to_string())) {
        Some(existing_prompt) if !existing_prompt.trim().is_empty() => existing_prompt,
        _ => prompt_for_user_request(&selected_specialist)?,
    };

    let workspace_id = ensure_workspace(&router, workspace_id).await?;
    let agent_role = selected_specialist.role.as_str();
    let agent_name = format!("cli-{}", selected_specialist.id);
    let create_response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "agents.create",
            "params": {
                "name": agent_name,
                "role": agent_role,
                "workspaceId": &workspace_id
            }
        }))
        .await;

    let agent_id = create_response
        .get("result")
        .and_then(|r| r.get("agentId"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            let error_msg = create_response
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown error");
            format!("Failed to create agent: {}", error_msg)
        })?
        .to_string();

    let session_id = uuid::Uuid::new_v4().to_string();
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());

    println!("╔══════════════════════════════════════════════════════════╗");
    println!("║  Routa CLI — Specialist Run                            ║");
    println!("╠══════════════════════════════════════════════════════════╣");
    println!("║  Specialist: {:<42} ║", selected_specialist.id);
    println!("║  Role      : {:<42} ║", agent_role);
    println!("║  Workspace : {:<42} ║", &workspace_id);
    println!("║  Provider  : {:<42} ║", provider);
    println!(
        "║  CWD       : {:<42} ║",
        super::prompt::truncate_path(&cwd, 42)
    );
    println!("╚══════════════════════════════════════════════════════════╝");
    println!();
    println!("📋 Prompt: {}", user_prompt);
    println!();

    state
        .acp_manager
        .create_session(
            session_id.clone(),
            cwd.clone(),
            workspace_id.clone(),
            Some(provider.to_string()),
            Some(agent_role.to_string()),
            None,
            None,
        )
        .await
        .map_err(|e| format!("Failed to create ACP session: {}", e))?;

    let acp = Arc::new(state.acp_manager.clone());
    let orchestrator = RoutaOrchestrator::new(
        OrchestratorConfig::default(),
        acp,
        state.agent_store.clone(),
        state.task_store.clone(),
        state.event_bus.clone(),
    );
    orchestrator
        .register_agent_session(&agent_id, &session_id)
        .await;

    let mut rx = state
        .acp_manager
        .subscribe(&session_id)
        .await
        .ok_or("Failed to subscribe to session updates")?;

    let initial_prompt =
        build_specialist_prompt(&selected_specialist, &agent_id, &workspace_id, &user_prompt);

    println!("🚀 Sending prompt to specialist...");
    println!();

    state
        .acp_manager
        .prompt(&session_id, &initial_prompt)
        .await
        .map_err(|e| format!("Failed to send prompt: {}", e))?;

    let mut idle_count = 0u32;
    let max_idle = 600;

    loop {
        match tokio::time::timeout(std::time::Duration::from_secs(1), rx.recv()).await {
            Ok(Ok(update)) => {
                idle_count = 0;
                super::prompt::handle_session_update(&update);
            }
            Ok(Err(_)) => {
                println!();
                println!("═══ Specialist session ended ═══");
                break;
            }
            Err(_) => {
                idle_count += 1;
                if idle_count >= max_idle {
                    println!();
                    println!("⏰ Timeout: no activity for {} seconds", max_idle);
                    break;
                }

                if !state.acp_manager.is_alive(&session_id).await {
                    println!();
                    println!("═══ Specialist process exited ═══");
                    break;
                }
            }
        }
    }

    println!();
    super::prompt::print_session_summary(&router, &workspace_id).await;

    state.acp_manager.kill_session(&session_id).await;
    orchestrator.cleanup(&session_id).await;

    Ok(())
}

fn load_specialists(specialist_dir: Option<&str>) -> Vec<SpecialistConfig> {
    let mut specialists = SpecialistConfig::list_available();

    if let Some(dir) = specialist_dir {
        let mut loader = SpecialistLoader::new();
        if loader.load_dir(dir).is_ok() {
            for specialist in loader
                .all()
                .values()
                .cloned()
                .filter_map(SpecialistConfig::from_specialist_def)
            {
                if let Some(index) = specialists
                    .iter()
                    .position(|current| current.id == specialist.id)
                {
                    specialists[index] = specialist;
                } else {
                    specialists.push(specialist);
                }
            }
        }
    }

    specialists.sort_by(|left, right| left.id.cmp(&right.id));
    specialists
}

fn parse_prompt_mention(prompt: Option<&str>) -> (Option<String>, Option<String>) {
    let Some(prompt) = prompt.map(str::trim) else {
        return (None, None);
    };

    let Some(without_marker) = prompt.strip_prefix('@') else {
        return (None, None);
    };

    let mut parts = without_marker.splitn(2, char::is_whitespace);
    let specialist = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_lowercase());
    let remainder = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    (specialist, remainder)
}

fn prompt_for_user_request(specialist: &SpecialistConfig) -> Result<String, String> {
    let theme = ColorfulTheme::default();
    let prompt = Input::with_theme(&theme)
        .with_prompt(format!("Prompt for {}", specialist.name))
        .interact_text()
        .map_err(|e| format!("Failed to read prompt: {}", e))?;

    Ok(prompt)
}

fn select_specialist(specialists: &[SpecialistConfig]) -> Result<SpecialistConfig, String> {
    let theme = ColorfulTheme::default();
    let items = specialists
        .iter()
        .map(|specialist| {
            format!(
                "{} ({}){}",
                specialist.id,
                specialist.role.as_str(),
                specialist
                    .description
                    .as_ref()
                    .map(|description| format!(" - {}", description))
                    .unwrap_or_default()
            )
        })
        .collect::<Vec<_>>();

    let index = Select::with_theme(&theme)
        .with_prompt("Select a specialist")
        .items(&items)
        .default(0)
        .interact()
        .map_err(|e| format!("Failed to select specialist: {}", e))?;

    Ok(specialists[index].clone())
}

fn find_specialist(specialists: &[SpecialistConfig], id: &str) -> Option<SpecialistConfig> {
    let target = id.to_lowercase();
    specialists
        .iter()
        .find(|specialist| specialist.id == target)
        .cloned()
}

fn build_specialist_prompt(
    specialist: &SpecialistConfig,
    agent_id: &str,
    workspace_id: &str,
    prompt: &str,
) -> String {
    format!(
        "{}\n\n---\n\n**Your Agent ID:** {}\n**Workspace ID:** {}\n\n## User Request\n\n{}\n\n---\n**Reminder:** {}\n",
        specialist.system_prompt,
        agent_id,
        workspace_id,
        prompt,
        specialist.role_reminder
    )
}

async fn ensure_workspace(router: &RpcRouter, workspace_id: &str) -> Result<String, String> {
    if workspace_id == "default" {
        return Ok("default".to_string());
    }

    let ws_response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "workspaces.get",
            "params": { "id": workspace_id }
        }))
        .await;

    if ws_response.get("error").is_none() {
        return Ok(workspace_id.to_string());
    }

    let create_resp = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "workspaces.create",
            "params": {
                "title": workspace_id
            }
        }))
        .await;

    if let Some(err) = create_resp.get("error") {
        let err_msg = err
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error");
        return Err(format!("Failed to create workspace: {}", err_msg));
    }

    let created_ws_id = create_resp
        .get("result")
        .and_then(|r| r.get("workspace"))
        .and_then(|w| w.get("id"))
        .and_then(|id| id.as_str())
        .ok_or("Failed to get created workspace ID")?
        .to_string();

    println!("Created workspace: {}", created_ws_id);
    Ok(created_ws_id)
}

#[cfg(test)]
mod tests {
    use super::parse_prompt_mention;

    #[test]
    fn parses_prompt_mentions_with_inline_prompt() {
        let (specialist, prompt) =
            parse_prompt_mention(Some("@view-git-change summarize the diff"));
        assert_eq!(specialist.as_deref(), Some("view-git-change"));
        assert_eq!(prompt.as_deref(), Some("summarize the diff"));
    }

    #[test]
    fn ignores_plain_prompts() {
        let (specialist, prompt) = parse_prompt_mention(Some("summarize the diff"));
        assert!(specialist.is_none());
        assert!(prompt.is_none());
    }
}
