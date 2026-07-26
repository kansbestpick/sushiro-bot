const { chromium } = require('playwright');
const fs = require('fs');

// 🛡️ Strict validation function for real Hong Kong Sushiro store names
function isValidStoreName(name) {
  if (!name) return false;
  name = name.trim();
  
  // Must end with "店" and have a reasonable store name length (3-20 chars)
  if (!name.endsWith('店')) return false;
  if (name.length < 3 || name.length > 20) return false;
  
  // Real store names have EXACTLY ONE "店" (at the very end)
  const storeCount = (name.match(/店/g) || []).length;
  if (storeCount !== 1) return false;

  // Filter out general UI headers, form labels, and instructions
  const garbageKeywords = ['預計', '排隊', '實況', '選擇', '你在那', '：', ':', '列表', '壽司店', '分店外', '點選', '全港', '等候時間'];
  if (garbageKeywords.some(kw => name.includes(kw))) return false;

  return true;
}

(async () => {
  console.log("Starting Sushiro Scraper (Clean Name Filtering & Full Store Count Fix)...");
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 }
  });

  try {
    console.log("Loading Sushiro web app...");
    await page.goto('https://sushirolic.web.app/desktop.html', { waitUntil: 'networkidle', timeout: 60000 });
    
    // 1. Give Firebase 6 seconds to fully render all 44+ stores in the DOM
    await page.waitForTimeout(6000);

    // 2. Scroll down to trigger lazy-loaded cards
    await page.evaluate(async () => {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 1000));
      window.scrollTo(0, 0);
      await new Promise(r => setTimeout(r, 500));
    });

    // 3. Find candidate elements
    const candidateElements = await page.locator('div, li, article, button').all();
    const storeLocators = [];
    const seenNames = new Set();
    const globalBlacklist = new Set();

    for (const locator of candidateElements) {
      const text = await locator.innerText().catch(() => '');
      if (!text) continue;

      const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
      
      // Find a valid store name on this card
      const name = lines.find(line => isValidStoreName(line));

      if (name && !seenNames.has(name) && (text.includes('組') || text.includes('分鐘') || text.includes('入座'))) {
        seenNames.add(name);

        const groupMatch = text.match(/(\d+)\s*組/);
        const timeMatch = text.match(/(\d+)\s*分鐘/);
        const groups = groupMatch ? parseInt(groupMatch[1], 10) : 0;
        const waitTime = timeMatch ? parseInt(timeMatch[1], 10) : 0;

        if (groups > 0) globalBlacklist.add(groups);
        if (waitTime > 0) globalBlacklist.add(waitTime);

        storeLocators.push({ locator, name, groups, waitTime });
      }
    }

    console.log(`Successfully verified ${storeLocators.length} real store locations.`);
    const outlets = [];

    for (let i = 0; i < storeLocators.length; i++) {
      const { locator, name, groups, waitTime } = storeLocators[i];
      let recentCalls = [];

      if (groups > 0) {
        try {
          await locator.click({ force: true, timeout: 1500 });
          await page.waitForTimeout(300);

          const panelText = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('div, section, aside, [class*="detail"], [class*="right"], [class*="drawer"]'));
            const detailPanel = elements.find(el => {
              const rect = el.getBoundingClientRect();
              return rect.left > 300 && rect.width > 200 && el.innerText && el.innerText.length > 10;
            });
            return detailPanel ? detailPanel.innerText : '';
          });

          if (panelText) {
            const rawMatches = panelText.match(/\b([A-Z]?\d{3})\b/gi) || [];
            recentCalls = [...new Set(rawMatches.map(m => m.toUpperCase()))].filter(num => {
              const val = parseInt(num.replace(/\D/g, ''), 10);
              return val >= 1 && val <= 999 && !globalBlacklist.has(val);
            });
          }
        } catch (e) {
          // Keep silent fallback
        }
      }

      if (groups === 0) {
        recentCalls = ['即時入座'];
      } else if (recentCalls.length === 0) {
        recentCalls = ['叫號中'];
      }

      outlets.push({
        id: i + 1,
        name_tc: name,
        region: 'KLN',
        waiting_groups: groups,
        wait_time: waitTime,
        address: '香港壽司郎分店',
        current_number: recentCalls[0],
        recent_calls: recentCalls.slice(0, 3)
      });
    }

    const payload = {
      updatedAt: new Date().toLocaleTimeString('zh-HK', { timeZone: 'Asia/Hong_Kong' }),
      outlets: outlets
    };

    fs.writeFileSync('live_data.json', JSON.stringify(payload, null, 2));
    console.log(`Saved ${outlets.length} clean stores to live_data.json`);

  } catch (err) {
    console.error("Scraper Error:", err);
  } finally {
    await browser.close();
  }
})();
