use std::collections::HashMap;
use std::io::{Read, Write};
use crate::models::User;

mod network;

struct Server {
    name: String,
}

enum Status {
    Active,
    Inactive,
}

trait Handler {
    fn handle(&self) -> bool;
}

trait AdvancedHandler: Handler {
    fn advanced(&self);
}

impl Handler for Server {
    fn handle(&self) -> bool {
        true
    }
}

impl Server {
    fn new(name: &str) -> Self {
        Server { name: name.to_string() }
    }

    fn start(&self) {
        let map = HashMap::new();
        self.handle();
    }
}

fn main() {
    let server = Server::new("test");
    server.start();
}

const MAX_RETRIES: usize = 3;

macro_rules! say_hello {
    () => { println!("hello"); };
}