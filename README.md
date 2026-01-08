# qrcodescan (Vue2)

H5 调用相机对单据扫码：页面提示 16:9 对准框，并只识别单据右上角 `3/16 × 3/9`（3格×3格）的二维码区域；拍照保存“手机摄像头整帧原图”，结果页展示二维码内容与原图。

## 运行

```bash
npm i
npm run serve
```

默认监听 `https://0.0.0.0:5173`（需要 HTTPS 才能在手机上稳定调用相机）。

## 本地 HTTPS（推荐 mkcert）

1) 安装 mkcert 并初始化本机根证书（只需一次）。

2) 在项目根目录创建证书文件（示例：给 `localhost` 和你的局域网 IP 签发）：

```bash
mkcert -key-file certs/dev.key -cert-file certs/dev.crt localhost 127.0.0.1 ::1 192.168.1.23
```

3) 创建 `.env.local`（可从 `.env.local.example` 复制）：

```bash
SSL_KEY_FILE=certs/dev.key
SSL_CRT_FILE=certs/dev.crt
```

4) 启动：

```bash
npm run serve
```

手机与电脑在同一 Wi‑Fi 下，用 `https://<电脑局域网IP>:5173/scan` 打开。

> iOS：需要把 mkcert 根证书导入手机，并在“设置 → 通用 → 关于本机 → 证书信任设置”中对该根证书开启完全信任，否则 Safari 会拦截相机权限。

## 关键逻辑

- 取景框：固定 `16:9`，居中显示（仅用于引导与 ROI 计算）。
- ROI：单据右上角 `3/16 × 3/9` 区域，实时裁剪放大后用 `jsQR` 解码。
- “已对准”判定：连续多帧识别到同一内容才提示（避免抖动闪烁）。

