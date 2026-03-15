#!/usr/bin/env python3

import argparse
import base64
import json
import os
import pty
import selectors
import signal
import struct
import subprocess
import sys
import termios
from typing import Optional


def set_winsize(fd: int, rows: Optional[int], cols: Optional[int]) -> None:
    if not rows or not cols:
        return
    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    try:
        termios.tcsetwinsize(fd, (rows, cols))
    except AttributeError:
        import fcntl

        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


def emit(frame: dict) -> None:
    sys.stdout.write(json.dumps(frame) + "\n")
    sys.stdout.flush()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cols", type=int, default=80)
    parser.add_argument("--rows", type=int, default=24)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()

    command = list(args.command)
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        raise SystemExit("Missing command")

    master_fd, slave_fd = pty.openpty()
    set_winsize(slave_fd, args.rows, args.cols)

    child = subprocess.Popen(
        command,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        close_fds=True,
        env=os.environ.copy(),
    )
    os.close(slave_fd)

    selector = selectors.DefaultSelector()
    stdin_fd = sys.stdin.fileno()
    selector.register(master_fd, selectors.EVENT_READ, "pty")
    selector.register(stdin_fd, selectors.EVENT_READ, "stdin")

    stdin_buffer = b""

    while True:
        events = selector.select(timeout=0.1)

        for key, _ in events:
            if key.data == "pty":
                try:
                    output = os.read(master_fd, 4096)
                except OSError:
                    output = b""
                if output:
                    emit({
                        "type": "output",
                        "data": base64.b64encode(output).decode("ascii"),
                    })
            else:
                incoming = os.read(stdin_fd, 4096)
                if not incoming:
                    continue
                stdin_buffer += incoming
                while b"\n" in stdin_buffer:
                    line, stdin_buffer = stdin_buffer.split(b"\n", 1)
                    if not line.strip():
                        continue
                    payload = json.loads(line.decode("utf-8"))
                    if payload.get("type") == "input":
                        data = payload.get("data", "")
                        if isinstance(data, str):
                            os.write(master_fd, base64.b64decode(data))
                    elif payload.get("type") == "resize":
                        rows = payload.get("rows")
                        cols = payload.get("cols")
                        if isinstance(rows, int) and isinstance(cols, int):
                            set_winsize(master_fd, rows, cols)
                            try:
                                os.kill(child.pid, signal.SIGWINCH)
                            except OSError:
                                pass

        if child.poll() is not None and not events:
            break

    exit_code = child.wait()
    emit({"type": "exit", "exitCode": exit_code})
    os.close(master_fd)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
