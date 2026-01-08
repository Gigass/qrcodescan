# qrcodescan (Vue2)

H5 调用相机对单据扫码：页面提示 16:9 对准框，并只识别单据右上角 `2/16 × 2/9`（2格×2格、内缩一格）的二维码区域；拍照保存“以取景框中心裁剪的 20:15（4:3）截图”，结果页展示二维码内容与截图。

## 运行

```bash
npm i
npm run serve
```

默认监听 `https://0.0.0.0:5173`（需要 HTTPS 才能在手机上稳定调用相机）。

## 本地测试（手机）

1) 电脑与手机在同一 Wi‑Fi 下。
2) 用电脑浏览器打开 devServer 的地址确认可访问。
3) 手机上用 `https://<电脑局域网IP>:5173/scan` 打开。

> 注意：移动端浏览器通常要求 HTTPS 才能调用相机权限；如果是自签证书，可能需要手动信任。

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

## 构建与本地部署验证（dist）

生产构建：

```bash
npm run build
```

构建产物在 `dist/`。

本地验证 `dist/`（需要 HTTPS 才能测试相机）：

```bash
npx http-server dist -S -C certs/dev.crt -K certs/dev.key -p 5173
```

然后打开 `https://<电脑局域网IP>:5173/scan`。

> 不需要测试相机时，也可以用 `python3 -m http.server -d dist 5173` 之类的纯 HTTP 静态服务。

## 部署

- 将 `dist/` 部署到任意静态托管（Nginx / OSS / CDN / GitHub Pages 等）。
- 线上必须是 HTTPS 才能在移动端稳定使用相机。

## 关键逻辑

- 取景框：固定 `16:9`，居中显示（仅用于引导与 ROI 计算）。
- ROI：单据右上角 `2/16 × 2/9` 区域（内缩一格），实时裁剪放大后用 `jsQR` 解码。
- “已对准”判定：连续多帧识别到同一内容才提示（避免抖动闪烁）。
- 拍照保存：以取景框中心裁剪成 `20:15`（4:3），并在取景框外额外扩展一些（见 `src/views/Scan.vue` 的 `CAPTURE_FRAME_EXPAND`）。
