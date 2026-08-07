use std::io::{self, Read, Write};
use std::thread;
use std::time::Duration;

fn value_after(args: &[String], flag: &str) -> Option<String> {
    args.windows(2)
        .find(|window| window[0] == flag)
        .map(|window| window[1].clone())
}

fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if let Some(value) = value_after(&args, "--stdout") {
        print!("{value}");
    }
    if let Some(value) = value_after(&args, "--stderr") {
        eprint!("{value}");
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
