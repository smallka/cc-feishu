"""
FeishuBot 启动脚本 - 带进程互斥锁
"""
import os
import sys
import time
import psutil
import subprocess
from pathlib import Path

LOCK_FILE = Path(os.environ['TEMP']) / 'feishubot.lock'
PROJECT_ROOT = Path(__file__).parent.parent


def get_running_instances():
    """获取所有运行中的 FeishuBot 进程"""
    instances = []
    for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
        try:
            if proc.info['name'] == 'python.exe':
                cmdline = proc.info['cmdline']
                if cmdline and any('src.main' in arg for arg in cmdline):
                    instances.append(proc)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    return instances


def kill_old_instances():
    """关闭所有旧实例"""
    instances = get_running_instances()
    if instances:
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Found {len(instances)} running instance(s), killing...")
        for proc in instances:
            try:
                print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Killing PID {proc.pid}")
                proc.kill()
                proc.wait(timeout=5)
            except Exception as e:
                print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Failed to kill {proc.pid}: {e}")
        time.sleep(2)


def acquire_lock():
    """尝试获取锁文件"""
    max_retries = 10
    for i in range(max_retries):
        try:
            # 使用独占模式创建锁文件
            fd = os.open(str(LOCK_FILE), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Lock acquired")
            return True
        except FileExistsError:
            # 锁文件存在，检查是否僵尸锁
            try:
                with open(LOCK_FILE, 'r') as f:
                    old_pid = int(f.read().strip())

                if not psutil.pid_exists(old_pid):
                    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Stale lock (PID {old_pid}), removing")
                    LOCK_FILE.unlink(missing_ok=True)
                    continue
                else:
                    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Lock held by PID {old_pid}, waiting...")
                    time.sleep(1)
            except Exception as e:
                print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Error checking lock: {e}")
                LOCK_FILE.unlink(missing_ok=True)
                continue

    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Failed to acquire lock after {max_retries} retries")
    return False


def release_lock():
    """释放锁文件"""
    try:
        LOCK_FILE.unlink(missing_ok=True)
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Lock released")
    except Exception as e:
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Error releasing lock: {e}")


def main():
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Starting FeishuBot service...")

    # 1. 先杀掉所有旧实例
    kill_old_instances()

    # 2. 获取锁
    if not acquire_lock():
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Failed to start: could not acquire lock")
        sys.exit(1)

    try:
        # 3. 启动主进程
        os.chdir(PROJECT_ROOT)
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Working directory: {PROJECT_ROOT}")
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Starting main process...")

        # 使用 subprocess 启动，这样可以保持进程独立
        import subprocess
        result = subprocess.run(
            [sys.executable, '-m', 'src.main'],
            cwd=PROJECT_ROOT,
            check=False
        )

        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Process exited with code {result.returncode}")
        sys.exit(result.returncode)

    except KeyboardInterrupt:
        print(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] Interrupted by user")
    except Exception as e:
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        release_lock()
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Service stopped")


if __name__ == '__main__':
    main()
