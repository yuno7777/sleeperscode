use std::fs::OpenOptions;
use std::io::{self, Read, Write};
use std::process::Command;
use std::thread;
use std::time::Duration;

fn value_after(args: &[String], flag: &str) -> Option<String> {
    args.windows(2)
        .find(|window| window[0] == flag)
        .map(|window| window[1].clone())
}

fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if let Some(depth) =
        value_after(&args, "--tree-depth").and_then(|value| value.parse::<u32>().ok())
    {
        let pid_file =
            value_after(&args, "--pid-file").expect("--pid-file is required for tree mode");
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&pid_file)
            .expect("open pid file");
        writeln!(file, "{}", std::process::id()).expect("write pid");
        file.flush().expect("flush pid");
        if depth > 0 {
            Command::new(std::env::current_exe().expect("resolve current fixture"))
                .args([
                    "--tree-depth",
                    &(depth - 1).to_string(),
                    "--pid-file",
                    &pid_file,
                ])
                .spawn()
                .expect("spawn fixture descendant");
        }
        thread::sleep(Duration::from_secs(30));
        return;
    }
    if let Some(value) = value_after(&args, "--stdout") {
        print!("{value}");
    }
    if let Some(value) = value_after(&args, "--stderr") {
        eprint!("{value}");
    }
    if args.iter().any(|arg| arg == "--print-cwd") {
        println!(
            "cwd={}",
            std::env::current_dir().expect("read cwd").display()
        );
    }
    if let Some(name) = value_after(&args, "--print-env") {
        println!(
            "env={}",
            std::env::var(name).unwrap_or_else(|_| "<missing>".into())
        );
    }
    if let Some(bytes) =
        value_after(&args, "--spam-bytes").and_then(|value| value.parse::<usize>().ok())
    {
        let chunk = vec![b'x'; 8 * 1024];
        let mut remaining = bytes;
        while remaining > 0 {
            let write = remaining.min(chunk.len());
            io::stdout().write_all(&chunk[..write]).expect("write spam");
            remaining -= write;
        }
    }
    if args.iter().any(|arg| arg == "--echo-stdin") {
        let mut input = Vec::new();
        io::stdin().read_to_end(&mut input).expect("read stdin");
        io::stdout().write_all(&input).expect("echo stdin");
    }
    if let Some(ms) = value_after(&args, "--sleep-ms").and_then(|value| value.parse().ok()) {
        thread::sleep(Duration::from_millis(ms));
    }
    if let Some(code) = value_after(&args, "--exit-code").and_then(|value| value.parse().ok()) {
        std::process::exit(code);
    }
}
