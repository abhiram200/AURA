use serde::Deserialize;

mod config;

pub struct App {
    name: String,
}

pub enum AppError {
    NotFound,
    Unauthorized(String),
}

pub trait Service {
    fn run(&self) -> Result<(), AppError>;
}

pub trait AdminService: Service {
    fn admin_panel(&self);
}

impl Service for App {
    fn run(&self) -> Result<(), AppError> {
        Ok(())
    }
}

impl App {
    pub fn new(name: &str) -> Self {
        App { name: name.to_string() }
    }
}

pub const APP_VERSION: &str = "1.0";

static GLOBAL_COUNT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);