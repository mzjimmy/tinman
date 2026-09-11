mod commands;
mod db;
mod dispatch;
mod error;
mod files;
mod gitutil;
mod llm;
mod queue;
mod runner;
mod scanner;
mod verify;
mod watch;
mod worktree;

use std::sync::{Arc, Mutex};

use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = commands::data_dir_from_app(app.handle())?;
            let conn = db::open(&data_dir.join("tinman.db"))?;
            app.manage(AppState {
                db: Mutex::new(conn),
                data_dir,
                children: Arc::new(crate::runner::LiveChildren::default()),
            });
            commands::recover_and_drain(app.handle());
            let handle = app.handle().clone();
            std::thread::Builder::new()
                .name("tinman-watch".into())
                .spawn(move || crate::watch::run_loop(handle))
                .ok();

            let add = MenuItemBuilder::with_id("add-folder", "Add Local Folder…")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;
            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&add)
                .separator()
                .quit()
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let robot = MenuItemBuilder::with_id("view-robot", "Robot")
                .accelerator("CmdOrCtrl+1")
                .build(app)?;
            let fleet = MenuItemBuilder::with_id("view-fleet", "Fleet")
                .accelerator("CmdOrCtrl+2")
                .build(app)?;
            let task = MenuItemBuilder::with_id("view-task", "Task")
                .accelerator("CmdOrCtrl+3")
                .build(app)?;
            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&robot)
                .item(&fleet)
                .item(&task)
                .build()?;

            let about = MenuItemBuilder::with_id("about", "About Tinman").build(app)?;
            let help_menu = SubmenuBuilder::new(app, "Help").item(&about).build()?;

            let menu = MenuBuilder::new(app)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&help_menu)
                .build()?;
            app.set_menu(menu)?;

            app.on_menu_event(|app, event| match event.id().as_ref() {
                "add-folder" => {
                    let _ = app.emit("menu", "add-folder");
                }
                "view-robot" => {
                    let _ = app.emit("menu", "view-robot");
                }
                "view-fleet" => {
                    let _ = app.emit("menu", "view-fleet");
                }
                "view-task" => {
                    let _ = app.emit("menu", "view-task");
                }
                "about" => {
                    app.dialog()
                        .message(
                            "Tinman is a local, read-only workbench.\n\
                             Scans never write into the project.\n\
                             Progress is derived from acceptance criteria — never guessed.",
                        )
                        .title("About Tinman")
                        .show(|_| {});
                }
                _ => {}
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_workspaces,
            commands::get_workspace,
            commands::create_workspace,
            commands::scan_workspace,
            commands::get_facts,
            commands::confirm_map,
            commands::update_prefs,
            commands::get_app_prefs,
            commands::set_app_prefs,
            commands::set_criterion_met,
            commands::list_files,
            commands::git_changes,
            commands::rename_workspace,
            commands::llm_call,
            commands::list_llm_calls,
            commands::add_criterion,
            commands::set_llm_key,
            commands::set_workspace_llm_profile,
            commands::app_paths,
            commands::list_tasks,
            commands::get_task,
            commands::read_task_log,
            commands::remove_worktree,
            commands::dispatch_task,
            commands::pause_task,
            commands::resume_task,
            commands::abandon_task,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
