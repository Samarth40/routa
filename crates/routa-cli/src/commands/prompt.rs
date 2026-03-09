//! `routa -p "requirement"` — Run the full Routa agent flow from CLI.
//!
//! Mirrors the web UI flow:
//! 1. Creates a workspace (or uses default)
//! 2. Spawns a ROUTA coordinator agent
//! 3. Sends the user's requirement as the initial prompt
//! 4. Streams session updates (agent messages, tool calls, delegations)
//! 5. Coordinator generates @@@task blocks → delegates to CRAFTER agents
//! 6. Waits for all child agents to complete

use std::sync::Arc;

use routa_core::models::agent::AgentRole;
use routa_core::orchestration::{OrchestratorConfig, RoutaOrchestrator, SpecialistConfig};
use routa_core::rpc::RpcRouter;
use routa_core::state::AppState;

/// Run the full Routa coordinator flow for a user prompt.
pub async fn run(
    state: &AppState,
    prompt: &str,
    workspace_id: &str,
    provider: &str,
) -> Result<(), String> {
    let router = RpcRouter::new(state.clone());
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());

    // ── 1. Use default workspace (always exists) ────────────────────────
    let workspace_id = if workspace_id == "default" {
        "default".to_string()
    } else {
        // For non-default workspaces, try to get or create
        let ws_response = router
            .handle_value(serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "workspaces.get",
                "params": { "id": workspace_id }
            }))
            .await;

        if ws_response.get("error").is_some() {
            // Create workspace if it doesn't exist
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

            // Get the created workspace ID
            let created_ws_id = create_resp
                .get("result")
                .and_then(|r| r.get("workspace"))
                .and_then(|w| w.get("id"))
                .and_then(|id| id.as_str())
                .ok_or("Failed to get created workspace ID")?
                .to_string();

            println!("Created workspace: {}", created_ws_id);
            created_ws_id
        } else {
            workspace_id.to_string()
        }
    };

    // ── 2. Create ROUTA coordinator agent ───────────────────────────────
    let agent_name = "cli-coordinator";
    let create_response = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "agents.create",
            "params": {
                "name": agent_name,
                "role": "ROUTA",
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
            format!("Failed to create coordinator agent: {}", error_msg)
        })?
        .to_string();

    // ── 3. Build coordinator prompt ─────────────────────────────────────
    let specialist =
        SpecialistConfig::by_role(&AgentRole::Routa).unwrap_or_else(SpecialistConfig::crafter);

    let coordinator_prompt = format!(
        "{}\n\n---\n\n\
         **Your Agent ID:** {}\n\
         **Workspace ID:** {}\n\n\
         ## User Request\n\n{}\n\n\
         ---\n**Reminder:** {}\n",
        specialist.system_prompt, agent_id, &workspace_id, prompt, specialist.role_reminder
    );

    // ── 4. Create ACP session for the coordinator ───────────────────────
    let session_id = uuid::Uuid::new_v4().to_string();

    println!("╔══════════════════════════════════════════════════════════╗");
    println!("║  Routa CLI — Multi-Agent Coordinator                    ║");
    println!("╠══════════════════════════════════════════════════════════╣");
    println!("║  Workspace : {:<42} ║", &workspace_id);
    println!("║  Agent     : {} (ROUTA)  {:<27} ║", &agent_id[..8], "");
    println!("║  Provider  : {:<42} ║", provider);
    println!("║  CWD       : {:<42} ║", truncate_path(&cwd, 42));
    println!("╚══════════════════════════════════════════════════════════╝");
    println!();
    println!("📋 Requirement: {}", prompt);
    println!();

    let spawn_result = state
        .acp_manager
        .create_session(
            session_id.clone(),
            cwd.clone(),
            workspace_id.clone(),
            Some(provider.to_string()),
            Some("ROUTA".to_string()),
            None,
            None, // branch
        )
        .await;

    match spawn_result {
        Ok((sid, _)) => {
            tracing::info!("Coordinator session created: {}", sid);
        }
        Err(e) => {
            return Err(format!("Failed to create ACP session: {}", e));
        }
    }

    // ── 5. Register with orchestrator ───────────────────────────────────
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

    // ── 6. Subscribe to session updates ─────────────────────────────────
    let mut rx = state
        .acp_manager
        .subscribe(&session_id)
        .await
        .ok_or("Failed to subscribe to session updates")?;

    // ── 7. Send the coordinator prompt ──────────────────────────────────
    println!("🚀 Sending requirement to coordinator...");
    println!();

    state
        .acp_manager
        .prompt(&session_id, &coordinator_prompt)
        .await
        .map_err(|e| format!("Failed to send prompt: {}", e))?;

    // ── 8. Stream updates until completion ──────────────────────────────
    let mut idle_count = 0u32;
    let max_idle = 600; // 10 minutes at 1s intervals

    loop {
        match tokio::time::timeout(std::time::Duration::from_secs(1), rx.recv()).await {
            Ok(Ok(update)) => {
                idle_count = 0;
                handle_session_update(&update);
            }
            Ok(Err(_)) => {
                // Channel closed — agent process ended
                println!();
                println!("═══ Coordinator session ended ═══");
                break;
            }
            Err(_) => {
                // Timeout — check if agent is still alive
                idle_count += 1;
                if idle_count >= max_idle {
                    println!();
                    println!("⏰ Timeout: no activity for {} seconds", max_idle);
                    break;
                }

                // Check if the process is still running
                if !state.acp_manager.is_alive(&session_id).await {
                    println!();
                    println!("═══ Coordinator process exited ═══");
                    break;
                }
            }
        }
    }

    // ── 9. Print summary ────────────────────────────────────────────────
    println!();
    print_session_summary(&router, &workspace_id).await;

    // ── 10. Cleanup ─────────────────────────────────────────────────────
    state.acp_manager.kill_session(&session_id).await;
    orchestrator.cleanup(&session_id).await;

    Ok(())
}

/// Handle a session/update notification and print to terminal.
pub(crate) fn handle_session_update(update: &serde_json::Value) {
    let params = match update.get("params") {
        Some(p) => p,
        None => return,
    };

    let inner = match params.get("update") {
        Some(u) => u,
        None => return,
    };

    let session_update = inner
        .get("sessionUpdate")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    match session_update {
        "agent_message" => {
            let text = inner
                .get("content")
                .and_then(|c| c.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or("");
            if !text.is_empty() {
                println!("🤖 {}", text);
            }
        }
        "agent_message_chunk" => {
            let text = inner
                .get("content")
                .and_then(|c| c.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or("");
            if !text.is_empty() {
                print!("{}", text);
                use std::io::Write;
                std::io::stdout().flush().ok();
            }
        }
        "agent_thought_chunk" => {
            let text = inner
                .get("content")
                .and_then(|c| c.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or("");
            if !text.is_empty() {
                print!("\x1b[2m{}\x1b[0m", text); // dim
                use std::io::Write;
                std::io::stdout().flush().ok();
            }
        }
        "tool_call" => {
            let kind = inner
                .get("kind")
                .or_else(|| inner.get("title"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let status = inner
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("running");
            println!();
            println!("  🔧 {} [{}]", kind, status);
        }
        "tool_call_update" => {
            let kind = inner
                .get("kind")
                .or_else(|| inner.get("title"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let status = inner
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("running");
            if status == "completed" || status == "failed" {
                let icon = if status == "completed" { "✅" } else { "❌" };
                println!("  {} {} [{}]", icon, kind, status);
            }
        }
        "process_output" => {
            let data = inner.get("data").and_then(|v| v.as_str()).unwrap_or("");
            if !data.is_empty() {
                eprint!("\x1b[90m{}\x1b[0m", data); // gray
            }
        }
        _ => {
            tracing::debug!("Unhandled session update: {}", session_update);
        }
    }
}

/// Print a summary of agents and tasks after the session completes.
pub(crate) async fn print_session_summary(router: &RpcRouter, workspace_id: &str) {
    println!("╔══════════════════════════════════════════════════════════╗");
    println!("║  Session Summary                                        ║");
    println!("╚══════════════════════════════════════════════════════════╝");

    // List agents
    let agents_resp = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 100,
            "method": "agents.list",
            "params": { "workspaceId": workspace_id }
        }))
        .await;

    if let Some(result) = agents_resp.get("result") {
        if let Some(agents) = result.get("agents").and_then(|a| a.as_array()) {
            println!();
            println!("  Agents ({}):", agents.len());
            for agent in agents {
                let name = agent.get("name").and_then(|v| v.as_str()).unwrap_or("?");
                let role = agent.get("role").and_then(|v| v.as_str()).unwrap_or("?");
                let status = agent.get("status").and_then(|v| v.as_str()).unwrap_or("?");
                let icon = match status {
                    "COMPLETED" => "✅",
                    "ACTIVE" => "🔄",
                    "ERROR" => "❌",
                    _ => "⏳",
                };
                println!("    {} {} ({}) — {}", icon, name, role, status);
            }
        }
    }

    // List tasks
    let tasks_resp = router
        .handle_value(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 101,
            "method": "tasks.list",
            "params": { "workspaceId": workspace_id }
        }))
        .await;

    if let Some(result) = tasks_resp.get("result") {
        if let Some(tasks) = result.get("tasks").and_then(|a| a.as_array()) {
            println!();
            println!("  Tasks ({}):", tasks.len());
            for task in tasks {
                let title = task.get("title").and_then(|v| v.as_str()).unwrap_or("?");
                let status = task.get("status").and_then(|v| v.as_str()).unwrap_or("?");
                let icon = match status {
                    "COMPLETED" => "✅",
                    "IN_PROGRESS" => "🔄",
                    "NEEDS_FIX" => "🔧",
                    "BLOCKED" => "🚫",
                    "CANCELLED" => "🗑️",
                    _ => "⏳",
                };
                println!("    {} {} — {}", icon, title, status);
            }
        }
    }

    println!();
}

pub(crate) fn truncate_path(path: &str, max_len: usize) -> String {
    if path.len() <= max_len {
        path.to_string()
    } else {
        format!("...{}", &path[path.len() - (max_len - 3)..])
    }
}
