# Milo 英文練習 1.4.0

[下載 1.4.0 APK](https://github.com/MtkWalter/ENG_APP/raw/refs/heads/apk-download/Milo-English-v1.4.0.apk)

更新後開啟 App 就會顯示 **ChatGPT 官方網頁**，可以在網站登入現有 ChatGPT 帳號，不必在 App 填 API key 或設定自己的伺服器。網站的對話直接顯示在 App 中。

Android 8.0 以上；與舊版使用相同簽章，可直接覆蓋更新，不需要先移除 App。原有 API 連線設定和 Milo 本機對話保留。

## 使用方式

1. 安裝新版後開啟 Milo，等待 ChatGPT 網頁載入。
2. 點網站的「登入」，以原有 ChatGPT 帳號登入。
3. 登入後直接在網站聊天。可使用的語音功能、使用額度與其他選項，依 ChatGPT 網站及你的帳號方案決定。

頂部保留返回、新對話、分享與「⋮」選單，其他空間留給網站。「⋮」可重新整理、回首頁、用手機瀏覽器開啟、清除此 App 的網站登入，或進入原本的「Milo 英文學習（API 模式）」。保留原有的啟動元件，避免更新後舊版桌面捷徑失效。

網站的 Cookie 與登入狀態由 App 內的 WebView 保存在手機；登入是否仍有效由網站決定，App 不會主動在關閉時登出。App 不讀取登入 Cookie、不擷取密碼或網頁對話內容，也不注入腳本或將網站登入轉成 API 憑證。

## 登入限制

**此版本尚未在 OPPO 實機驗證真實登入。** ChatGPT 或 Google／Apple 等登入提供者可能拒絕內嵌瀏覽器，App 不能保證每種登入方式都可用，也不繞過這些限制。若網站拒絕登入，可從「⋮ → 用手機瀏覽器開啟」在瀏覽器使用 ChatGPT。

手機瀏覽器與 App 各自保存登入狀態，**在 Chrome 登入不會自動讓 App 內也登入**。如果你的登入方式始終不接受 WebView，需在手機瀏覽器使用 ChatGPT，或選擇 App 原有的 API 模式。

網頁模式不呼叫 Milo 的 OpenAI API，網站功能及費用依 ChatGPT 方案計算。Milo 自訂的 KK、選句翻譯、0.5 倍朗讀與持續收音控制仍在 API 模式，無法直接套用到 ChatGPT 網頁。

網站若要求麥克風，App 會先確認來源及請求使用者允許 Android 麥克風權限；不會授權攝影機或其他網站使用麥克風。曾允許麥克風後，離開 App 會關閉該頁面的收音，回來重新載入對話；尚未送出的語音可能需要重說。

## 驗證

65 項 Android/JVM 回歸測試通過，0 失敗、0 錯誤、0 跳過，包含 Android 9／11／15／16 的新入口、Cookie 與畫面重建，以及登入導覽、返回、新對話、分享、麥克風權限及 TLS 錯誤處理。45 項 Java 核心斷言通過。Debug、Release、裝置測試 APK 編譯成功；提供下載的是與舊版相同簽章的 debug APK。Android Lint 為 0 錯誤，另有 1 項 Android 13 返回手勢屬性相容性提示，舊版 Android 會忽略該屬性。

本次雲端環境的出站規則未開放 chatgpt.com，實際連線在平台代理 CONNECT 階段收到 403。因此上述自動測試驗證 App 的 Android 與 WebView 流程，不代表已驗證真實網站渲染、帳號登入或網站語音。

舊版檔案保留供回溯；`Milo-English-v1.0.apk` 為最新相容檔名。SHA-256 校驗碼見 SHA256SUMS。
