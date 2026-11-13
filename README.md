# Milo 2.0.0 單字 KK／中文小視窗與語音排版

[OPPO Reno13 Pro 請下載這個 APK（arm64，約 24 MB）](https://raw.githubusercontent.com/MtkWalter/ENG_APP/apk-download/Milo-English-v2.0.0-arm64.apk)

[其他架構可下載通用 APK（約 71 MB）](https://raw.githubusercontent.com/MtkWalter/ENG_APP/apk-download/Milo-English-v2.0.0.apk)

版本代碼 16，Android 8.0 以上，與 1.9.1 相同簽章，可直接覆蓋更新。

## 點單字直接顯示 KK 與翻譯

在 Milo 內的 ChatGPT 對話點一下英文單字，小視窗會依序顯示「英文 → KK 音標 → 繁體中文」。不需要再點「翻譯」，不切換 Google 翻譯 App，也不需要 API key。保留朗讀及 0.5 倍慢讀。長按拖曳可選整句；整句只顯示英文與中文，不顯示 KK。

隨 App 附帶約 125,112 筆美式發音與 100,497 筆英中釋義；兩者的收錄範圍不完全相同。`new` 可直接顯示 `[nu] / [nju]` 與「新的」等釋義。常見單字可離線查詢，缺少發音時會明確顯示未收錄，不猜測 KK。

KK 由 CMUdict 的美式 ARPABET 發音轉寫，採 KK 符號、傳統弱讀母音及英語最大音節起首規則放置重音，最多保留三種讀法；不是 Yahoo／Dr.eye 原始 KK，也不使用 ECDICT 英式 IPA 冒充 KK。讀法及重音音節分界可能與其他字典不同。中文釋義來自 ECDICT，建置時以 OpenCC 轉為繁體，是字典釋義而非依整段對話判斷的唯一語意。授權與來源見 [DICTIONARY-LICENSES.txt](DICTIONARY-LICENSES.txt)，APK 也包含相同說明及來源雜湊。

整句與缺少釋義的詞使用 Google ML Kit 裝置端翻譯。首次需要連網下載英文／中文模型，之後可離線使用；不需要另外安裝 Google 翻譯 App。Android 10 以上將模型結果轉成繁體，Android 8／9 沿用模型的中文。不恢復之前 MyMemory／Yahoo／Dr.eye 網頁查詢。

小視窗留在同一個聊天 Activity，開啟查字不會因切換 App 而停止網站收音。關閉、切換選字或離開前景後會取消／捨棄舊查詢結果。點字只在可信 ChatGPT 訊息內啟用，不觸發連結、按鈕或輸入欄位；長按最多接收明確選取的 5,000 字元，不讀取 Cookie、剪貼簿或擷取整頁對話。

## 語音時保持對話在下方操作區上方

保留上方「新對話、A−、A+」及下方精簡語音操作，文字輸入、附件與模型選擇維持隱藏。新增訊息區底部避讓及最新回覆跟隨；字體、操作列高度及視窗大小改變時重新計算，讓最新對話停在底部區域上方。手動往上看舊訊息或正在選取文字時不強制捲到底部，捲回底部後可繼續跟隨。這些調整只適用 Milo 內嵌頁面，外部 Chrome 網頁由瀏覽器控制。

## 驗證與適用範圍

106 項 Android/JVM 測試及 32 項 Chromium 合成頁面檢查通過，涵蓋實際內建字典、KK／中文小視窗、關閉與晚到結果、單點選字、跨行內格式的單字、整句選取、語音區域避讓、手動捲動及字體縮放。APK 編譯成功，Android Lint 0 錯誤、3 項提示。arm64 翻譯原生庫符合 16 KB ELF 對齊，兩種 APK 的對齊及簽章檢查通過。

尚未在 OPPO 實機、現行 ChatGPT 網站或 Google 翻譯模型上實測。雲端連線限制無法載入真實 ChatGPT，瀏覽器使用本機合成頁面；句子翻譯畫面用替身結果驗證。不能將這些測試視為已確認現行網站相容性或實際模型翻譯準確率。未辨識的網頁結構仍可能需要調整。

arm64 APK：24,723,366 bytes，SHA-256 `425e553c5d672d90419635a4b38271fbd84b309088959177e93e9616dab85388`。

通用 APK：70,986,788 bytes，SHA-256 `681b77c2f896c06a836aa416791ce542cda9fc7385efe4b9442bffa388d8c97f`。

全部歷史 APK 保留。Milo-English-v1.0.apk 為最新版通用 APK 的相容檔名；完整校驗碼見 SHA256SUMS。
