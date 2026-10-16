# Wundadi

開源的門診系統。下載後用空的資料庫跑起來，不包含任何診所的病歷、安全模組或藥價整包。

## 從零開始

需要 Python 3.12 與 Node.js。

```bat
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
cd frontend
npm install
cd ..
啟動-Wundadi門診.bat
```

畫面是 http://127.0.0.1:3010 ，資料介面是 http://127.0.0.1:5000/docs 。
第一次會在 `data/` 長出這台電腦自己的資料庫。這個資料夾不會進版控。

院所代碼、讀卡機與雲端安全模組要在自己的電腦上設定。程式裡預設的機構代碼只是範例，上線前請改成貴院所的。

## 藥價

GitHub Actions 每月向健保署與食藥署的公開資料拉一次，過關就挂上一個 Release。
整表被清空、筆數過少，或單一藥價暴衝，就不會發佈。

在自己的電腦上雙擊：

```bat
scripts\tools\抓取藥價包.bat
```

抓完後重新啟動門診，新的藥價包會裝進查價。舊病歷仍用就醫當天的價格。

授權：MIT，見 LICENSE。
