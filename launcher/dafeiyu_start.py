# -*- coding: utf-8 -*-
"""
大肥鱼一键启动器 v2
双击后按依赖顺序拉起四个组件：
  1) 模型服务 llama-server (8090)
  2) QQ 客户端 (被 SnowLuma 注入)
  3) SnowLuma 网关 (注入 QQ 后监听 3000/3001)
  4) POC 桥 (WS 连 3001)
已运行的自动跳过。每个组件独立窗口，关掉启动器不影响它们。
--dry-run：只检测状态、不启动任何进程（自检用）。
"""
import os
import sys
import json
import time
import socket
import datetime
import subprocess

try:
    os.system("chcp 65001 >nul")
except Exception:
    pass
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MODEL_BAT = r"E:\bonsai-local\START_QWEN3VL8B_IQ4XS_8090.bat"
QQ_EXE = r"D:\qq\QQ.exe"
QQ_ARG = "-q"
QQ_UIN = "10000"  # ← 改成你的QQ号（-q 参数自动登录）
GATEWAY_EXE = r"C:\SnowLuma\node.exe"
GATEWAY_JS = r"C:\SnowLuma\index.mjs"
BRIDGE_BAT = r"E:\bonsai-local\START_POC_BRIDGE.bat"
HEARTBEAT = r"D:\wokebuddy\poc_heartbeat.json"

NEW_CONSOLE = 0x00000010
DRY = "--dry-run" in sys.argv


def port_open(port, host="127.0.0.1", timeout=0.5):
    try:
        with socket.create_connection((host, port), timeout):
            return True
    except OSError:
        return False


def bridge_alive(max_age=90):
    try:
        with open(HEARTBEAT, encoding="utf-8") as f:
            d = json.load(f)
        t = datetime.datetime.fromisoformat(str(d["time"]).replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=datetime.timezone.utc)
        age = (datetime.datetime.now(datetime.timezone.utc) - t).total_seconds()
        return (0 <= age <= max_age), int(age)
    except Exception:
        return False, -1


def qq_running():
    try:
        out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq QQ.exe"],
                             capture_output=True, text=True, timeout=8).stdout
        return "QQ.exe" in out
    except Exception:
        return False


def status():
    m = port_open(8090)
    g = port_open(3000) or port_open(3001)
    b, age = bridge_alive()
    q = qq_running()
    return m, q, g, b, age


def show_status():
    m, q, g, b, age = status()
    suffix = f"（心跳 {age} 秒前）" if 0 <= age < 100000 else ""
    print(f"  1 模型服务 8090 : {'运行中' if m else '未运行'}")
    print(f"  2 QQ 客户端     : {'运行中' if q else '未运行'}")
    print(f"  3 SnowLuma网关  : {'运行中' if g else '未运行'}  (OneBot 3000/3001)")
    print(f"  4 POC桥 心跳    : {'运行中' if b else '未运行'}{suffix}")
    return m, q, g, b


def launch(label, cmd, cwd):
    print(f"  -> 启动 {label} ...", flush=True)
    if DRY:
        print("     [试运行] 跳过实际启动")
        return
    try:
        subprocess.Popen(cmd, cwd=cwd, creationflags=NEW_CONSOLE)
        print("     命令已发出（独立窗口）")
    except Exception as e:
        print(f"     启动失败: {e}")


def wait_for(label, check, seconds, tick=3):
    """等某个条件成立，返回是否成功。"""
    if DRY:
        return False
    end = time.time() + seconds
    n = 0
    while time.time() < end:
        time.sleep(tick)
        n += tick
        if check():
            print(f"     {label} 就绪（约 {n}s）", flush=True)
            return True
    print(f"     {label} 等待 {seconds}s 仍未就绪", flush=True)
    return False


def main():
    print("=" * 62)
    print("  大肥鱼 一键启动 v2  ·  模型 + QQ + 网关 + 桥")
    print("=" * 62)
    if DRY:
        print("  [试运行模式：只检测状态，不启动任何进程]")
    print()

    print("[1/4] 当前状态")
    m, q, g, b = show_status()

    if m and q and g and b:
        print("\n  四个组件都在运行，无需启动。")
    else:
        print("\n[2/4] 启动缺失组件（按依赖顺序）")
        if not m:
            launch("① 模型服务 llama-server (8090)", ["cmd", "/c", MODEL_BAT],
                   r"E:\bonsai-local")
        else:
            print("  ① 模型服务已在运行，跳过")

        if not q:
            launch("② QQ 客户端", [QQ_EXE, QQ_ARG, QQ_UIN], r"D:\qq")
            print("     等 QQ 登录并注入（约 10-30 秒）")
        else:
            print("  ② QQ 客户端已在运行，跳过")

        if not g:
            launch("③ SnowLuma 网关", [GATEWAY_EXE, GATEWAY_JS], r"C:\SnowLuma")
        else:
            print("  ③ SnowLuma 网关已在运行，跳过")

        # 网关必须等 QQ 注入后才监听 3000/3001
        print("\n[3/4] 等待 OneBot 端口（3000/3001）就绪 ...")
        if not DRY:
            ready = wait_for("OneBot", lambda: port_open(3000) or port_open(3001), 90)
            if not ready:
                print("     提示：若 QQ 弹出登录/验证窗口，请先完成登录。")
        else:
            print("     [试运行] 跳过等待")

        if not b:
            launch("④ POC 桥", ["cmd", "/c", BRIDGE_BAT], r"E:\bonsai-local")
        else:
            print("  ④ POC 桥已在运行，跳过")

        print("\n[4/4] 等待桥连上 WS（最多 60 秒）")
        if not DRY:
            wait_for("POC桥", lambda: bridge_alive()[0], 60)
            print("\n最终状态：")
            m, q, g, b = show_status()
        else:
            print("     [试运行] 跳过等待")

    print("\n" + "-" * 62)
    if m and q and g and b:
        print("  全部就绪，可以去 QQ 找她聊天了。")
    else:
        print("  还有组件没起来。请看各组件独立窗口的报错，")
        print("  或把本窗口内容截图发我。")
    if not DRY:
        try:
            input("\n  按回车关闭本窗口（组件会继续运行）...")
        except Exception:
            time.sleep(600)  # 非交互场景保活，避免误杀子进程


if __name__ == "__main__":
    main()
