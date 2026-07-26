const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log("Starting Sushiro Scraper (Extracting Tickets from Popup Only)...");
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 }
  });

  try {
    console.log("Loading Sushiro queue page...");
    await page.goto('https://sushirolic.web.app/desktop.html', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(4000);

    const ignoreNames = ['列表', '九龍', '新界', '港島', '即時排隊', '壽司郎'];

    // Find all store elements on the page
    const cardLocators = await page.locator('div, li, article, button').filter({ hasText: /店/ }).all();
    
    const storeLocators = [];
    const seenNames = new Set();

    for (const locator of cardLocators) {
      const text = await locator.innerText().catch(() => '');
      const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
      const name = lines.find(l => l.includes('店') && !ignoreNames.some(ign => l.includes(ign)) && l.length < 25);

      if (name && !seenNames.has(name) && (text.includes('組') || text.includes('分鐘'))) {
        seenNames.add(name);
        storeLocators.push({ locator, name, cardText: text });
      }
    }

    console.log(`Found ${storeLocators.length} valid store locations.`);
    const outlets = [];

    for (let i = 0; i < storeLocators.length; i++) {
      const { locator, name, cardText } = storeLocators[i];

      const groupMatch = cardText.match(/(\d+)\s*組/);
      const timeMatch = cardText.match(/(\d+)\s*分鐘/);
      const groups = groupMatch ? parseInt(groupMatch[1], 10) : 0;
      const waitTime = timeMatch ? parseInt(timeMatch[1], 10) : 0;

      let recentCalls = [];

      if (groups > 0) {
        try {
          // Click to open the side popup drawer
          await locator.click({ force: true, timeout: 1200 });
          await page.waitForTimeout(400); // Wait for animation

          // 🚨 CRITICAL FIX: Only extract text from the active popup, NOT the whole page!
          const modalText = await page.evaluate(() => {
            const drawers = document.querySelectorAll('aside, [role="dialog"], [class*="drawer"], [class*="modal"], [class*="panel"]');
            if (drawers.length > 0) {
              // Return the text of the most recently opened popup
              return drawers[drawers.length - 1].innerText;
            }
            return ''; // If popup not found, return empty to prevent reading background addresses
          });

          // Match strict 3-digit numbers from the popup only
          const rawMatches = modalText.match(/\b\d{3}\b/g) || [];
          
          recentCalls = [...new Set(rawMatches)].filter(num => {
            const val = parseInt(num, 10);
            return val >= 1 && val <= 999 && val !== groups && val !== waitTime;
          });
        } catch (e) {
          console.log(`Failed to read popup for ${name}`);
        }
      }

      // Safe Fallbacks
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
    console.log(`Successfully saved data for ${outlets.length} stores to live_data.json`);

  } catch (err) {
    console.error("Scraper encountered an error:", err);
  } finally {
    await browser.close();
  }
})();
