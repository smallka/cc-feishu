# 仓库协作说明

## 提交约束
- Python 和 TypeScript 改动尽量分开提交。
- 提交消息使用 Conventional Commits。
- Python 改动使用 `<type>: [py] <summary>`；TypeScript 改动使用 `<type>: [ts] <summary>`。
- 文档、仓库配置、CI 等非 Python/TypeScript 改动不加 `[py]` 或 `[ts]`。

## 编码约束
- 所有源码、脚本、文档文件统一使用 UTF-8 编码保存。
- 只要文件里包含中文，就不能使用 GBK、ANSI、Windows-1252 等本地编码保存。
- 特别是 TypeScript 源文件，若编码错误，`tsc` 会按 UTF-8 读取并把中文编进产物，最终在飞书里显示为乱码。

## 已知问题
- 这次已经踩过一次编码坑：`apps/typescript/src/bot/menu-context.ts` 曾被按 GBK/ANSI 保存。
- 直接表现是飞书菜单卡片里的中文变成类似 `0. ȡ��`、`�ظ�����ѡ��60 ���ʧЧ��` 的乱码。
- 如果再次看到 `锟斤拷`、`ȡ��`、`鍙敤`、`�` 这类文本，优先检查源码文件编码，而不是先怀疑飞书接口。

## 写文件注意事项
- 使用 PowerShell 写回文件时，不要依赖默认编码。
- 明确使用 UTF-8 写入，例如 `[System.IO.File]::WriteAllText(path, content, [System.Text.UTF8Encoding]::new($true))`。
- 修改包含中文的文件后，必要时可用十六进制检查中文是否为 UTF-8 字节，而不是 GBK 字节。
