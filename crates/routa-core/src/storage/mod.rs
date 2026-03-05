//! Storage Module — Unified storage layer for sessions and traces.
//!
//! Provides the folder slug algorithm and local storage path utilities
//! that mirror the TypeScript implementation for cross-platform consistency.

mod folder_slug;

pub use folder_slug::*;
