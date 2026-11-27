# Milo 2.0.7

[下載 OPPO Reno13 Pro 版](https://raw.githubusercontent.com/MtkWalter/ENG_APP/apk-download/Milo-English-v2.0.7-arm64.apk) · [下載通用版](https://raw.githubusercontent.com/MtkWalter/ENG_APP/apk-download/Milo-English-v2.0.7.apk)

麥克風位於 App 工具列的 A+ 右側。點一下開始語音，通話中可點一下切換靜音。當網站提供結束通話功能時，長按即可結束。

雙方訊息裡的英文以醒目配色顯示，包含混合中文的英文句子與正在產生的回覆。可用 A−、A+ 調整字級，也可直接點英文單字或長按選句查詢。

版本代碼 23，可直接覆蓋安裝。已在自動化測試中驗證工具列排列、語音控制與英文標示，尚未在 OPPO 實機測試。檔案校驗碼見 [SHA256SUMS](SHA256SUMS)。

## 歷史版本 2.0.6 單一麥克風

[下載 OPPO Reno13 Pro 版](https://raw.githubusercontent.com/MtkWalter/ENG_APP/apk-download/Milo-English-v2.0.6-arm64.apk) · [下載通用版](https://raw.githubusercontent.com/MtkWalter/ENG_APP/apk-download/Milo-English-v2.0.6.apk)

點上方麥克風開始連續語音。通話中點一下可靜音或恢復收音。當網站提供結束通話控制時，長按麥克風即可結束。側邊欄、分享、設定等網頁元素若與這一列重疊，App 會隱藏重疊部分，讓麥克風能收到點擊。若網站只提供結束或送出動作，按鈕顯示該動作原有的圖示。

版本代碼 22，可直接覆蓋安裝。本版在手機尺寸的 Chromium 測試頁驗證過點擊、長按及控制列位置，尚未在 OPPO 實機測試。完整校驗碼見 [SHA256SUMS](SHA256SUMS)。

## 歷史版本 2.0.5 上方操作列相容性與語音排版效能

[OPPO Reno13 Pro 下載（arm64，約 24 MB）](https://raw.githubusercontent.com/MtkWalter/ENG_APP/apk-download/Milo-English-v2.0.5-arm64.apk)

[其他架構通用 APK（約 71 MB）](https://raw.githubusercontent.com/MtkWalter/ENG_APP/apk-download/Milo-English-v2.0.5.apk)

版本代碼 21，Android 8.0 以上，與 2.0.4 相同簽章，可直接覆蓋更新。

## 操作區移到上方

使用者截圖中的完整輸入框仍在底部。本次修正兩種在 2.0.4 失敗的重現：網站限制新增無 nonce 的樣式表，以及輸入框沒有舊識別碼。兩種都會造成相同症狀，但尚未確認手機現行網站是哪一種原因。

透過可還原的 CSSOM 屬性設定套用排版，並辨識語意輸入框，不修改網站安全政策。操作列固定在原生「新對話、A−、A+」列下方，對話使用下方空間。延續精簡控制、原麥克風／語音事件、查字及字體調整；非聊天表單保持可用。

## 降低語音對話時的額外排版工作

長回覆改由末端找文字；捲到底部按鈕先比對明確標籤，再量測樣式，避免每次遍歷歷史按鈕。操作列也不再因 AI 文字節點的更新而掃描整頁。保留同一輪回覆的逐畫面位置追蹤，不等下一輪才調整。

相同本機 Chromium 測試（100 輪歷史對話、每輪 5 個操作按鈕、當前回覆 180 段、30 次即時更新）中，樣式讀取 139,854→1,460 次、文字範圍量測 8,326→46 次，約少 99%。這是 DOM 工作量，不能當作手機加速比例或語音不卡頓的保證；尚未量測 OPPO 音訊、網路、網站回應或手機幀率。

## 學習功能沿用

點英文單字顯示「英文 → KK 音標 → 繁體中文」小視窗；整句不顯示 KK。保留朗讀及 0.5 倍慢讀。內建約 125,112 筆美式發音與 100,497 筆英中釋義，收錄範圍不完全相同。

KK 由 CMUdict 美式 ARPABET 轉寫，並非 Yahoo 原始 KK；中文詞義來自 ECDICT，建置時轉繁體，缺少發音不猜測。來源及授權見 [DICTIONARY-LICENSES.txt](DICTIONARY-LICENSES.txt)。整句及缺少釋義的詞使用 Google ML Kit 裝置端翻譯，首次需下載模型，免 API key。亮屏與麥克風系統授權流程沿用。

## 驗證

63 項 Chromium 檢查通過（36 對話／選字、19 操作列、6 語音球、2 效能回歸），另有 11 項網頁腳本／語音生命週期 Android/JVM 測試通過。本次未重跑完整 Android 測試套件。Lint 0 錯誤、3 項既有提示。

帶 nonce 的合成頁面中，操作區 y=564→0，原麥克風與語音事件可點擊。正式 Android 腳本與 APK 資產相符，簽章及 16 KB ZIP 對齊檢查通過。這些均為本機合成頁檢查，尚未在 OPPO 或目前真實 ChatGPT 網站實測。

arm64：24,731,206 bytes，SHA-256 `0a765d1d4d91a89ef3cce1ed4f7e5d5b8d7e7bc2b11e6b28b47dcb25e04fa75d`。

通用版：70,994,628 bytes，SHA-256 `b6e5d08f09185009ec591a203aea5f548ddb37de796ebc83a2dafd234db33785`。

歷史 APK 保留；Milo-English-v1.0.apk 為最新通用版相容檔名。完整校驗碼見 SHA256SUMS。
