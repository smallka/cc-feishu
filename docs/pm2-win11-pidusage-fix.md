# PM2 在 Windows 11 下 `wmic ENOENT` 的修复记录

## 现象

在 Windows 11 上使用 `pm2` 时，`C:\Users\<user>\.pm2\pm2.log` 持续出现类似报错：

```text
PM2             | Error caught while calling pidusage
PM2             | Error: Error: spawn wmic ENOENT
```

应用本身通常还能运行，但 PM2 的资源采集会异常，日志里也会持续刷错。

## 根因

当前环境中的 `pm2@6.0.14` 仍然内置 `pidusage@3.0.2`。这个版本在 Windows 上依赖 `wmic` 获取进程信息。

Windows 11 上 `wmic` 可能不存在或默认不可用，因此 PM2 会持续报 `spawn wmic ENOENT`。

## 解决思路

手工将 PM2 内置的 `pidusage` 从 `3.0.2` 替换为 `4.0.0`。

`pidusage@4.0.0` 已加入适配 Windows 11 的实现，不再只依赖旧的 `wmic` 路径。

## 适用范围

本方案适用于全局安装的 PM2，默认路径类似：

- `C:\Users\<user>\AppData\Roaming\npm\node_modules\pm2`

若你的 Node / npm 全局目录不同，请先确认实际安装路径。

## 操作步骤

### 1. 下载 `pidusage@4.0.0`

```powershell
npm.cmd pack pidusage@4.0.0
```

执行后会得到：

```text
pidusage-4.0.0.tgz
```

### 2. 解压安装包

```powershell
tar -xf .\pidusage-4.0.0.tgz
```

解压后会得到 `package\` 目录，后续要用其中这些文件：

- `package\index.js`
- `package\package.json`
- `package\lib\*`

### 3. 备份 PM2 自带的旧版本

需要备份两个目录：

- `C:\Users\<user>\AppData\Roaming\npm\node_modules\pm2\node_modules\pidusage`
- `C:\Users\<user>\AppData\Roaming\npm\node_modules\pm2\node_modules\pm2-sysmonit\node_modules\pidusage`

示例：

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

Copy-Item `
  C:\Users\<user>\AppData\Roaming\npm\node_modules\pm2\node_modules\pidusage `
  C:\Users\<user>\AppData\Roaming\npm\node_modules\pm2\node_modules\pidusage.bak-$stamp `
  -Recurse -Force

Copy-Item `
  C:\Users\<user>\AppData\Roaming\npm\node_modules\pm2\node_modules\pm2-sysmonit\node_modules\pidusage `
  C:\Users\<user>\AppData\Roaming\npm\node_modules\pm2\node_modules\pm2-sysmonit\node_modules\pidusage.bak-$stamp `
  -Recurse -Force
```

### 4. 用 `4.0.0` 覆盖旧文件

先覆盖 `pm2\node_modules\pidusage`：

```powershell
Remove-Item C:\Users\<user>\AppData\Roaming\npm\node_modules\pm2\node_modules\pidusage\lib -Recurse -Force
Copy-Item .\package\lib C:\Users\<user>\AppData\Roaming\npm\node_modules\pm2\node_modules\pidusage\lib -Recurse -Force
Copy-Item .\package\index.js C:\Users\<user>\AppData\Roaming\npm\node_modules\pm2\node_modules\pidusage\index.js -Force
Copy-Item .\package\package.json C:\Users\<user>\AppData\Roaming\npm\node_modules\pm2\node_modules\pidusage\package.json -Force
```

再覆盖 `pm2-sysmonit` 内部那份：

```powershell
Remove-Item C:\Users\<user>\AppData\Roaming\npm\node_modules\pm2\node_modules\pm2-sysmonit\node_modules\pidusage\lib -Recurse -Force
Copy-Item .\package\lib C:\Users\<user>\AppData\Roaming\npm\node_modules\pm2\node_modules\pm2-sysmonit\node_modules\pidusage\lib -Recurse -Force
Copy-Item .\package\index.js C:\Users\<user>\AppData\Roaming\npm\node_modules\pm2\node_modules\pm2-sysmonit\node_modules\pidusage\index.js -Force
Copy-Item .\package\package.json C:\Users\<user>\AppData\Roaming\npm\node_modules\pm2\node_modules\pm2-sysmonit\node_modules\pidusage\package.json -Force
```

### 5. 重启 PM2 daemon

补丁写入磁盘后，需要重启 PM2 才会加载新代码：

```powershell
pm2.cmd kill
pm2.cmd start ecosystem.config.js
pm2.cmd save
```

## 验证

验证 `pidusage` 已变成 `4.0.0`：

```powershell
Get-Content C:\Users\<user>\AppData\Roaming\npm\node_modules\pm2\node_modules\pidusage\package.json
```

确认新版本包含 `gwmi.js`：

```powershell
Get-Item C:\Users\<user>\AppData\Roaming\npm\node_modules\pm2\node_modules\pidusage\lib\gwmi.js
```

查看 PM2 日志确认 `wmic ENOENT` 不再继续出现：

```powershell
Get-Content C:\Users\<user>\.pm2\pm2.log -Tail 100
```

## 风险与注意事项

- 这是手工 patch 全局 PM2 依赖，不是 PM2 官方安装流程的一部分。
- 后续如果重新安装或升级 PM2，这个补丁可能会被覆盖，需要重新执行。
- 操作前一定要备份原目录。
- 如果之前存在错误的 PM2 进程配置，建议顺手清理旧进程和旧日志，避免和这次问题混在一起。

## 本次实际环境

本次排查时的实际情况：

- PM2 版本：`6.0.14`
- 原始 `pidusage` 版本：`3.0.2`
- 替换目标版本：`4.0.0`
