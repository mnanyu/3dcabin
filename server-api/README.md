# 钓鱼背包 API

零第三方依赖的 Python 3 + SQLite 服务，监听 `127.0.0.1:8765`，由 nginx 以 `/api/fishing/` 反向代理。

## 用户数据

- 每个浏览器第一次访问 `GET /api/fishing/me` 时，服务端生成一条独立用户数据并通过 HttpOnly Cookie 记住
- 用户数据包含称呼、创建时间、最近访问时间、最近 IP、30 天渔获统计与背包清单
- 最近 IP 取自 nginx 传入的 `X-Real-IP`，只在后台接口返回，不会出现在公开背包接口里
- 后台会异步调用 ip-api.com 解析国家/地区/城市，失败时回退 ipinfo.io；结果缓存在 `ip_geo` 表 7 天，内网/本地 IP 标记为「本地/内网」
- 管理接口的每个用户会返回 `lastIp`、`ipLocation`、`ipIsp`、`ipStatus` 字段
- 称呼写入时检查唯一性；非空称呼不能重复，忽略英文大小写，「无名钓客」为保留名称
- 每次钓到鱼写入一条背包记录：鱼种、长度、上钩时间
- 公开背包/榜单展示最近 30 天；数据库保留策略：有渔获 6 个月，有称呼无渔获 3 个月，无称呼无渔获 1 个月（滚动）
- 事件 ID 唯一约束：同一渔获重试不会重复计数
- 旧版的 localStorage UID 可以通过 `?legacy_uid=...` 在首次请求时认领，保留已经同步到服务器的历史渔获

## 接口

- `GET /api/fishing/health`
- `GET /api/fishing/me` → 用户数据 + 背包 + 鱼种统计 + 全站榜
- `POST /api/fishing/profile` → `{name}`；非空称呼重复时返回 409
- `POST /api/fishing/catch` → `{event_id, species, length}`
- `POST /api/fishing/feedback` → `{message, contact, page, website}`，反馈入库并尝试发到站长邮箱

## 后台管理

后台页面：`/<admin-path>/`，由 nginx 从 `/path/to/admin/` 提供；旧 `/admin/` 已返回 404。接口全部在 `/api/fishing/admin/` 下：

- `POST /api/fishing/admin/login` → `{password}`，成功后写入 12 小时 HttpOnly 会话 Cookie
- `POST /api/fishing/admin/logout`
- `GET /api/fishing/admin/overview`
- `GET /api/fishing/admin/feedback?limit=`
- `GET /api/fishing/admin/users?q=&page=&limit=`
- `GET /api/fishing/admin/user?uid=`
- `POST /api/fishing/admin/update-user` → `{uid, name}`
- `POST /api/fishing/admin/delete-catch` → `{id}`
- `POST /api/fishing/admin/delete-user` → `{uid}`

除登录和退出外，管理接口要求已登录会话，并携带 `X-Admin-Request: 1`。登录失败 5 分钟内最多 8 次。

密码不写在代码里。`/path/to/admin.env` 保存 PBKDF2 盐和哈希，systemd 通过 `EnvironmentFile` 注入。重新生成密码：

```bash
python3 set_admin_password.py '新密码' | sudo tee /path/to/admin.env
sudo chown root:www-data /path/to/admin.env
sudo chmod 640 /path/to/admin.env
sudo systemctl restart forest-cabin-api.service
```

## 数据位置

- 数据库：`/path/to/fishing.db`
- 表：`users`（含 `last_ip`）、`catches`、`ip_geo`（IP 地理位置缓存）、`feedback`（反馈与邮件状态）
- 反馈邮件默认通过 FormSubmit 转发到 `you@example.com`，首次需要在邮箱点击 Activate Form；也可改用 SMTP
- systemd：`forest-cabin-api.service`，运行用户 `www-data`
- 定时清理：`forest-cabin-cleanup.timer`，每天 04:20 执行 `cleanup_retention.py`
