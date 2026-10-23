# 階段 1-B：獨立 Redis／PostgreSQL／多程序與重啟測試

## 範圍

執行實際 `createDMWorker`、BullMQ、Redis CAS、PostgreSQL 防重、GiftClaim 與逾時計時器。
四個獨立 Node 程序，每個沿用正式程式的 concurrency=5、lockDuration=30000、stalledInterval=30000。
Instagram 與寄信邊界改接本機 HTTP 接收器；沒有讀取正式 `.env`，網路 guard 只允許三個指定 loopback 連接埠。

獨立環境不等於正式 Railway：本測試驗證實際工作程序被終止／重新啟動的行為，沒有驗收 Railway 的監督、重啟政策或 Meta／SMTP 投遞。

## 專用服務

只在 `OpenReply-Test` WSL 發行版運行，與既有 Docker／正式服務隔離。Redis 26379、PostgreSQL 25432、本機訊息接收器 26480；均使用 127.0.0.1。

首次建立：透過 WSL 官方安裝入口建立名為 `OpenReply-Test` 的 Debian；安裝 Redis、PostgreSQL 17。建立期間以 policy-rc.d 阻止套件自動啟動預設埠。然後執行 `services.sh start`。此指令限首次使用，不會清空現有資料。

Windows 專案根目錄執行：

```powershell
node scripts/integration/follow-gate/run.mjs 'C:\absolute\new-evidence-directory'
```

每輪使用新的證據資料夾。腳本建立本輪虛構活動及帳號，保留先前測試資料；沒有 flush Redis、刪除真人 claim 或套用正式資料庫遷移。
`run.mjs` 僅向該獨立資料庫套用專案 SQL；服務 URL 硬限本機測試埠，執行前另外檢查 Redis 的專用環境標記。

## 情境

1. 同一人 1,000 次點擊，四程序共同處理；查詢／確認中／結果各一次。
2. 100 人各 10 次，追蹤與未追蹤各 50 人；未驗證 Email 不送禮。
3. 20 人 API 永不回應；使用真實時間及 HTTP 中止驗證 8＋2＋8 秒收尾。
4. 真實間隔五次未追蹤及第六次冷卻，沒有將時鐘跳到未來。
5. 查詢途中強殺實際 Node 程序，測試監督器自動啟動新程序；持久補救一次。
6. 所有 worker 停止，再以 SIGKILL 終止測試 Redis；AOF 重啟後仍有狀態與工作，恢復 worker 才收尾。
7. 接收器已收到結果但尚未回應時強殺；持久防重阻止重寄，留下未確認提示。
8. Redis 已提交 checking、程式尚未收到 CAS 回覆時停止：測試 hook 只暫停真實提交的回覆，隨後強殺程序，檢查補救入列前的中斷空隙。

保留原始事件、來源 SHA-256、各情境結果於 MD。測試接收器所見的接受不等於真人送達。

## 收尾與保留

執行 `services.sh stop`，或停止專用 WSL 發行版。保留資料及測試證據供重跑，不自動刪除發行版。
重跑前用 `pg_ctlcluster 17 main start` 及相同 Redis 參數啟動既有資料即可；不要再次建立同名 role／database。
