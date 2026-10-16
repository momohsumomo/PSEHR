# -*- coding: utf-8 -*-
import os
import re
import sys

# 解決 Windows 終端機列印 Unicode (Emoji) 時的編碼問題
if sys.platform.startswith('win'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        # 舊版 Python 相容性
        import codecs
        sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer)

# 專案路徑設定
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML_OUTPUT_PATH = os.path.join(WORKSPACE_DIR, "docs", "專案模組地圖與除錯導航門戶.html")

# 模組定義
MODULES = {
    "讀卡與掛號模組": {
        "icon": "🚪",
        "sandbox": "s3",
        "sandbox_label": "沙盒 3",
        "desc": "負責與物理健保卡讀卡機（PCSC 通訊協定）連線，並銜接虛擬健保卡 API / 掛號進場註冊流程。",
        "keywords": "讀卡 健保卡 PCSC nhi reader 註冊 診間掛號",
        "symptom": "❌ 卡片讀不到 / 連線超時？",
        "solution": "1. 執行 <code>python utils/nhi_reader.py pcsc</code> 檢測硬體驅動。<br>2. 確認健保卡控制軟體 6.0 於背景 Port <code>5066</code> 正常運作。<br>3. 檢查後端 <code>src/api/routers/nhi.py</code> 串接格式。",
        "files": ["utils/nhi_reader.py", "src/api/routers/patient.py", "src/api/routers/nhi.py"]
    },
    "藥品與處方管理": {
        "icon": "💊",
        "sandbox": "s2",
        "sandbox_label": "沙盒 2 / 1",
        "desc": "負責處理當次就醫的開藥處方、健保申報碼對照、RxNorm 以及藥物與患者病歷的過敏 CDSS 防撞機制。",
        "keywords": "藥品 處方 開藥 健保碼 藥理 過敏 cdss drug code",
        "symptom": "❌ 藥物過敏警告未彈出 / 找不到藥？",
        "solution": "1. 檢查後端 <code>allergy_intolerance.py</code> 的過敏檢索匹配邏輯。<br>2. 檢查前端 <code>CurrentRxWidget.tsx</code> 是否在處方變更時觸發防撞 API。",
        "files": ["src/api/routers/medication_request.py", "frontend/src/pages/DrugCatalogPage.tsx", "frontend/src/components/clinic/widgets/CurrentRxWidget.tsx"]
    },
    "病人資料與預診": {
        "icon": "👤",
        "sandbox": "s1",
        "sandbox_label": "沙盒 1 / 2",
        "desc": "患者自訴預診填寫頁面、病人基本資料整合、歷次看診 SOAP 病歷摘要與生命徵象拉取。",
        "keywords": "病人 病歷 預診 previsit patient soap 主訴 CC",
        "symptom": "❌ 雙擊排隊名單無法載入病歷？",
        "solution": "1. 排查 <code>outpatient.py</code> 的 <code>/workspace/{encounterId}</code> 是否噴 500。<br>2. 確認 SQLite 中的 <code>Encounter</code> 與 <code>Patient</code> 的 ID 關聯沒有損毀。",
        "files": ["frontend/src/pages/PatientPreVisitPage.tsx", "src/api/routers/outpatient.py", "frontend/src/components/clinic/widgets/ChiefComplaintWidget.tsx"]
    },
    "UI/UX診間工作台": {
        "icon": "💻",
        "sandbox": "s1",
        "sandbox_label": "沙盒 1",
        "desc": "負責皮膚科醫生雙欄看診工作台的配置驅動排版、各類看板組件渲染，以及診間快速鍵監聽。",
        "keywords": "ui ux 診間 雙欄 版面 快捷鍵 f2 f10 drag custom layout",
        "symptom": "❌ 元件版面崩壞 / 快捷鍵失效？",
        "solution": "1. 檢查 <code>ui-config.json</code> 是否是合法的 JSON。<br>2. 確認 Widget 元件最外層是否保留了 <code>w-full h-full min-h-0</code>。<br>3. 至 <code>ClinicOutpatientPage.tsx</code> 搜尋快速鍵監聽器。",
        "files": ["frontend/src/pages/ClinicOutpatientPage.tsx", "frontend/src/config/ui-config.json"]
    },
    "雙層SQLite資料庫": {
        "icon": "🗄️",
        "sandbox": "infra",
        "sandbox_label": "基礎建設",
        "desc": "系統的儲存底座。實作雙層快取機制：一層完整 FHIR JSON (<code>resource_cache</code>) ＋另一層供快速查詢的 SQL 索引貼紙表。",
        "keywords": "資料庫 SQLite shadow db fhir cache 貼紙 基礎建設 SQL",
        "symptom": "❌ 存入資料後用 SQL 查不到？",
        "solution": "1. 後端寫入時是否同步更新了對應的快取貼紙表（如 <code>_update_patient_index</code>）。<br>2. 呼叫 <code>GET /sandbox/dual-layer/{type}/{id}</code> 比對雙層落庫一致性。",
        "files": ["src/infrastructure/sqlite_shadow_store.py", "data/shadow.db"]
    },
    "皮膚病灶影像模組": {
        "icon": "📸",
        "sandbox": "s2",
        "sandbox_label": "沙盒 2 / 1",
        "desc": "提供皮膚科的核心價值：影像記錄。管理病灶縮圖、時間軸、放大對照以及 Base64 照片落庫關聯機制。",
        "keywords": "病灶 影像 照片 media base64 photo lesion",
        "symptom": "❌ 照片上傳後無法顯示 / 空白？",
        "solution": "1. 檢查 <code>media.py</code> 是否收到正確的 Base64 格式，並確認存入 DB。<br>2. 檢查前端 <code>LesionPhotosWidget.tsx</code> 是否能正確轉換 Base64 URL 渲染。",
        "files": ["src/api/routers/media.py", "frontend/src/components/clinic/widgets/LesionPhotosWidget.tsx"]
    }
}

# 檔案掃描排除名單
EXCLUDE_DIRS = {".git", "node_modules", "dist", ".venv", "__pycache__", "BkZip", "temp_utf8"}

def scan_files_for_annotations():
    """
    掃描全專案檔案，如果檔案內含有 `@module: 模組名稱` 的註解，則動態將其加入該模組檔案清單。
    例如：
    在 Python 中：# @module: 讀卡與掛號模組
    在 TypeScript 中：// @module: UI/UX診間工作台
    """
    print("🔍 開始掃描專案檔案以搜尋 @module 註解標記...")
    
    # 用來正則匹配
    # 支援 # @module: XXX 或 // @module: XXX
    pattern = re.compile(r'(@module\s*:\s*)([^\r\n\s]+)')

    for root, dirs, files in os.walk(WORKSPACE_DIR):
        # 過濾排除目錄
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        
        for file in files:
            file_path = os.path.join(root, file)
            # 取得相對專案根目錄的路徑，並轉換為正斜線 /
            rel_path = os.path.relpath(file_path, WORKSPACE_DIR).replace('\\', '/')
            
            # 只讀取文字檔以防二進位檔噴錯
            if not file.endswith(('.py', '.tsx', '.ts', '.html', '.css', '.json', '.bat', '.sh', '.md', '.txt')):
                continue
                
            try:
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                    match = pattern.search(content)
                    if match:
                        module_name = match.group(2).strip()
                        # 精確比對或部分比對
                        matched_key = None
                        for key in MODULES.keys():
                            if module_name in key or key in module_name:
                                matched_key = key
                                break
                        
                        if matched_key:
                            if rel_path not in MODULES[matched_key]["files"]:
                                MODULES[matched_key]["files"].append(rel_path)
                                print(f"  📌 偵測到標記：[{rel_path}] ➜ 已指派至模組 [{matched_key}]")
            except Exception as e:
                pass

def generate_file_item_html(file_path):
    # 決定 icon
    ext = os.path.splitext(file_path)[1]
    icon = "📄"
    if ext == ".py":
        icon = "🐍"
    elif ext in (".tsx", ".ts"):
        icon = "⚛️"
    elif ext == ".json":
        icon = "⚙️"
    elif ext == ".db":
        icon = "💾"
        
    # 如果是 components/clinic/widgets，顯示精簡路徑
    display_path = file_path
    if "frontend/src/components/clinic/" in file_path:
        display_path = file_path.replace("frontend/src/components/clinic/", "widgets/")

    return f"""        <li class="file-item" onclick="copyPath('{file_path}')">
          <span class="file-icon">{icon}</span> {display_path}
          <span class="copy-btn" title="複製路徑">📋</span>
        </li>"""

def generate_card_html(module_name, data):
    file_items = "\n".join([generate_file_item_html(f) for f in data["files"]])
    
    # 判斷 sandbox 類型樣式
    tag_class = f"tag-{data['sandbox']}"
    
    return f"""    <!-- {module_name} -->
    <article class="module-card {data['sandbox']}" data-keywords="{data['keywords']}">
      <div class="card-header">
        <h2 class="card-title"><span class="icon">{data['icon']}</span>{module_name}</h2>
        <span class="sandbox-tag {tag_class}">{data['sandbox_label']}</span>
      </div>
      <p class="module-desc">{data['desc']}</p>
      
      <h3 class="section-title">核心程式碼檔案路徑</h3>
      <ul class="file-list">
{file_items}
      </ul>

      <div class="trouble-box">
        <h4 class="trouble-symptom">{data['symptom']}</h4>
        <p class="trouble-solution">
          {data['solution']}
        </p>
      </div>
    </article>"""

def main():
    # 1. 掃描專案檔案，獲取動態模組指派
    scan_files_for_annotations()
    
    # 2. 構造所有模組 Cards HTML
    cards_html = []
    for module_name, data in MODULES.items():
        cards_html.append(generate_card_html(module_name, data))
        
    all_cards_html = "\n\n".join(cards_html)
    
    # 3. 生成完整 HTML 檔案
    html_template = f"""<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Wundadi FHIR HIS — 專案模組地圖與除錯導航門戶</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&family=Noto+Sans+TC:wght@300;400;500;700&display=swap');

    :root {{
      --bg: #090b11;
      --surface: #131722;
      --surface-hover: #1b2030;
      --border: #22293a;
      --border-focus: #3e4d6f;
      --text: #f0f3f8;
      --text-muted: #8892b0;
      --primary: #4f46e5;
      --primary-glow: rgba(79, 70, 229, 0.4);
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --info: #06b6d4;
    }}

    * {{
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }}

    body {{
      font-family: 'Outfit', 'Noto Sans TC', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 40px 24px;
      max-width: 1400px;
      margin: 0 auto;
    }}

    header {{
      margin-bottom: 40px;
      position: relative;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
    }}

    header h1 {{
      font-size: 2.2rem;
      font-weight: 700;
      background: linear-gradient(135deg, #a5b4fc 0%, #6366f1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
      letter-spacing: -0.02em;
    }}

    header p {{
      color: var(--text-muted);
      font-size: 1rem;
    }}

    .badge-bar {{
      display: flex;
      gap: 10px;
      margin-top: 12px;
      flex-wrap: wrap;
    }}

    .badge {{
      font-size: 0.75rem;
      padding: 4px 10px;
      border-radius: 20px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border);
      color: var(--text-muted);
      cursor: pointer;
      user-select: none;
    }}

    .badge.active {{
      background: rgba(99, 102, 241, 0.15);
      border-color: rgba(99, 102, 241, 0.4);
      color: #a5b4fc;
    }}

    .search-container {{
      margin-bottom: 30px;
      position: relative;
    }}

    .search-input {{
      width: 100%;
      background: var(--surface);
      border: 1px solid var(--border);
      padding: 16px 20px;
      border-radius: 12px;
      color: var(--text);
      font-size: 1.05rem;
      transition: all 0.25s ease;
      font-family: inherit;
    }}

    .search-input:focus {{
      outline: none;
      border-color: var(--border-focus);
      box-shadow: 0 0 15px rgba(99, 102, 241, 0.1);
    }}

    .modules-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
      gap: 24px;
    }}

    @media (max-width: 768px) {{
      .modules-grid {{
        grid-template-columns: 1fr;
      }}
    }}

    .module-card {{
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      overflow: hidden;
    }}

    .module-card::before {{
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 4px;
      height: 100%;
      background: var(--primary);
      opacity: 0.8;
    }}

    .module-card:hover {{
      transform: translateY(-4px);
      border-color: var(--border-focus);
      box-shadow: 0 10px 25px -10px rgba(0, 0, 0, 0.5);
      background: var(--surface-hover);
    }}

    .card-header {{
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
    }}

    .card-title {{
      font-size: 1.3rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }}

    .card-title span.icon {{
      font-size: 1.6rem;
    }}

    .sandbox-tag {{
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      padding: 3px 8px;
      border-radius: 4px;
      letter-spacing: 0.05em;
    }}

    .tag-s1 {{ background: rgba(6, 182, 212, 0.15); color: var(--info); border: 1px solid rgba(6, 182, 212, 0.3); }}
    .tag-s2 {{ background: rgba(99, 102, 241, 0.15); color: #a5b4fc; border: 1px solid rgba(99, 102, 241, 0.3); }}
    .tag-s3 {{ background: rgba(245, 158, 11, 0.15); color: var(--warning); border: 1px solid rgba(245, 158, 11, 0.3); }}
    .tag-infra {{ background: rgba(16, 185, 129, 0.15); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.3); }}

    .module-desc {{
      color: var(--text-muted);
      font-size: 0.92rem;
      margin-bottom: 20px;
      min-height: 48px;
    }}

    .section-title {{
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 8px;
      font-weight: 700;
    }}

    .file-list {{
      list-style: none;
      margin-bottom: 20px;
    }}

    .file-item {{
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: 6px;
      font-size: 0.82rem;
      margin-bottom: 6px;
      font-family: 'Consolas', monospace;
      color: #cbd5e1;
      transition: all 0.2s ease;
      cursor: pointer;
    }}

    .file-item:hover {{
      background: rgba(255, 255, 255, 0.06);
      border-color: rgba(255, 255, 255, 0.1);
      color: #fff;
    }}

    .file-item .file-icon {{
      font-size: 1rem;
      opacity: 0.7;
    }}

    .copy-btn {{
      margin-left: auto;
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.2s ease;
      padding: 2px;
    }}

    .file-item:hover .copy-btn {{
      opacity: 1;
    }}

    .copy-btn:hover {{
      color: #fff;
    }}

    .trouble-box {{
      background: rgba(239, 68, 68, 0.04);
      border: 1px dashed rgba(239, 68, 68, 0.2);
      border-radius: 10px;
      padding: 14px;
      font-size: 0.88rem;
      margin-top: auto;
    }}

    .trouble-symptom {{
      color: #fca5a5;
      font-weight: 600;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 6px;
    }}

    .trouble-solution {{
      color: var(--text-muted);
      line-height: 1.4;
    }}

    .trouble-solution code {{
      background: rgba(0, 0, 0, 0.2);
      padding: 1px 4px;
      border-radius: 4px;
      color: #fbcfe8;
      font-family: monospace;
    }}

    /* Color code cards differently based on their primary roles */
    .module-card.s1::before {{ background: var(--info); }}
    .module-card.s2::before {{ background: var(--primary); }}
    .module-card.s3::before {{ background: var(--warning); }}
    .module-card.infra::before {{ background: var(--success); }}

    .bottom-tips {{
      margin-top: 40px;
      padding: 20px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border);
      text-align: center;
      font-size: 0.9rem;
      color: var(--text-muted);
    }}

    .bottom-tips code {{
      color: #a5b4fc;
      background: rgba(0, 0, 0, 0.3);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
    }}

    .hidden {{
      display: none !important;
    }}
  </style>
</head>
<body>

  <header>
    <h1>Wundadi FHIR HIS — 專案模組地圖與除錯門戶</h1>
    <p>提供人類友好的直覺入口，協助任何人（與未來的你）在 3 秒內定位問題與故障檔案</p>
    <div class="badge-bar">
      <span class="badge active">🧭 全專案導覽</span>
      <span class="badge">🚀 沙盒 1 (前端 UI)</span>
      <span class="badge">⚙️ 沙盒 2 (後端 APIs)</span>
      <span class="badge">🔌 沙盒 3 (健保卡讀卡)</span>
      <span class="badge">💾 基礎資料庫</span>
    </div>
  </header>

  <div class="search-container">
    <input type="text" id="searchInput" class="search-input" placeholder="🔍 輸入關鍵字搜尋模組（例如：讀卡、開藥、Allergy、Database...）" />
  </div>

  <main class="modules-grid" id="modulesGrid">
{all_cards_html}
  </main>

  <div class="bottom-tips">
    💡 貼心提示：我們已為您在此專案的根目錄建立了 <code>Wundadi-FHIR.code-workspace</code> 工作區設定檔。<br>
    使用 VS Code 或 Cursor 打開該工作區，您將在左側側邊欄看到<b>「中文命名、依模組劃分」</b>的虛擬資料夾結構，既不影響真實路徑，又極其一目瞭然！
    <br><br>
    🔄 此地圖支援自動更新！若新增檔案，可在檔案開頭加上 <code># @module: 模組名稱</code> (Python) 或 <code>// @module: 模組名稱</code> (TSX)，並執行：<br>
    <code>python scripts/update_project_map.py</code> 即可實時重新整理此網頁。
  </div>

  <script>
    // Search function
    const searchInput = document.getElementById('searchInput');
    const cards = document.querySelectorAll('.module-card');
    
    searchInput.addEventListener('input', function() {{
      const query = this.value.toLowerCase().trim();
      
      cards.forEach(card => {{
        const keywords = card.getAttribute('data-keywords').toLowerCase();
        const title = card.querySelector('.card-title').textContent.toLowerCase();
        const desc = card.querySelector('.module-desc').textContent.toLowerCase();
        
        if (keywords.includes(query) || title.includes(query) || desc.includes(query)) {{
          card.classList.remove('hidden');
        }} else {{
          card.classList.add('hidden');
        }}
      }});
    }});

    // Copy path function
    function copyPath(path) {{
      navigator.clipboard.writeText(path).then(() => {{
        // Simple visual feedback
        const el = event.currentTarget;
        const originalText = el.innerHTML;
        el.style.backgroundColor = 'rgba(16, 185, 129, 0.2)';
        el.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        
        setTimeout(() => {{
          el.style.backgroundColor = '';
          el.style.borderColor = '';
        }}, 1000);
      }});
    }}

    // Filter by badges
    const badges = document.querySelectorAll('.badge');
    badges.forEach(badge => {{
      badge.addEventListener('click', function() {{
        badges.forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        
        const filterText = this.textContent;
        cards.forEach(card => {{
          card.classList.remove('hidden');
          if (filterText.includes('沙盒 1') && !card.classList.contains('s1')) card.classList.add('hidden');
          if (filterText.includes('沙盒 2') && !card.classList.contains('s2')) card.classList.add('hidden');
          if (filterText.includes('沙盒 3') && !card.classList.contains('s3')) card.classList.add('hidden');
          if (filterText.includes('基礎資料庫') && !card.classList.contains('infra')) card.classList.add('hidden');
        }});
      }});
    }});
  </script>
</body>
</html>"""

    # 4. 寫入檔案
    with open(HTML_OUTPUT_PATH, 'w', encoding='utf-8') as f:
        f.write(html_template)
    
    print(f"🎉 成功！已重新生成並實時更新至：{HTML_OUTPUT_PATH}")

if __name__ == "__main__":
    main()
