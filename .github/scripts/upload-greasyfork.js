// Upload built userscript to GreasyFork using Puppeteer
// Requires GREASYFORK_USERNAME and GREASYFORK_PASSWORD environment variables

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

(async () => {
    const username = process.env.GREASYFORK_USERNAME;
    const password = process.env.GREASYFORK_PASSWORD;

    if (!username || !password) {
        console.error('GREASYFORK_USERNAME and GREASYFORK_PASSWORD must be set in environment');
        process.exit(1);
    }

    const scriptPath = path.resolve(process.cwd(), 'youtube.user.js');
    if (!fs.existsSync(scriptPath)) {
        console.error('Built script not found at', scriptPath);
        process.exit(1);
    }

    const scriptContent = fs.readFileSync(scriptPath, 'utf8');

    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();

    try {
        await page.goto('https://greasyfork.org/en/login', { waitUntil: 'networkidle2' });

        // Fill login form
        await page.type('#user_login', username, { delay: 50 });
        await page.type('#user_password', password, { delay: 50 });
        await Promise.all([
            page.click('input[type="submit"]'),
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);

        // Check for successful login
        if (page.url().includes('/login')) {
            console.error('Login failed - check credentials or captcha');
            await browser.close();
            process.exit(1);
        }

        // Determine whether to update an existing script or create new
        const scriptId = process.env.GREASYFORK_SCRIPT_ID;
        if (scriptId) {
            // Try both /en/ and /ru/ paths
            const editUrls = [
                `https://greasyfork.org/en/scripts/${scriptId}/edit`,
                `https://greasyfork.org/ru/scripts/${scriptId}/edit`,
            ];

            let loaded = false;
            for (const url of editUrls) {
                try {
                    await page.goto(url, { waitUntil: 'networkidle2' });
                    // If we landed on login or 404, skip
                    if (page.url().includes('/login') || page.url().includes('/404') || page.url().includes('/errors')) {
                        continue;
                    }
                    loaded = true;
                    console.log('Opened edit page:', page.url());
                    break;
                } catch {
                    // try next
                }
            }

            if (!loaded) {
                throw new Error('Could not open edit page for script ID ' + scriptId);
            }

            // Fill code into editor/textarea
            await page.evaluate((code) => {
                const ta = document.querySelector('textarea#script_code');
                if (ta) {
                    ta.value = code;
                    ta.dispatchEvent(new Event('input', { bubbles: true }));
                }
                const cm = document.querySelector('.CodeMirror');
                if (cm && cm.CodeMirror) {
                    cm.CodeMirror.setValue(code);
                }
            }, scriptContent);

            // Optionally update title or description if present in form
            const titleMatch = scriptContent.match(/@name\s+(.+)/);
            if (titleMatch) {
                const title = titleMatch[1].trim();
                const nameEl = await page.$('#script_name');
                if (nameEl) {
                    await page.evaluate((v) => { const el = document.querySelector('#script_name'); if (el) el.value = v; }, title);
                }
            }

            // Click save/submit button (there may be a button[type=submit] or input.save)
            const submitSelector = 'button[type="submit"], input[type="submit"], button.save';
            const btn = await page.$(submitSelector);
            if (!btn) {
                throw new Error('Save button not found on edit page');
            }

            await Promise.all([
                btn.click(),
                page.waitForNavigation({ waitUntil: 'networkidle2' }),
            ]);
            console.log('Update finished, current URL:', page.url());
        } else {
            // Create a new script (fallback)
            await page.goto('https://greasyfork.org/en/scripts/new', { waitUntil: 'networkidle2' });

            // Fill title (extract from header metadata or use package.json name)
            const titleMatch = scriptContent.match(/@name\s+(.+)/);
            const title = titleMatch ? titleMatch[1].trim() : require(path.resolve(process.cwd(), 'package.json')).name;

            await page.type('#script_name', title, { delay: 20 });

            // Fill description (optional)
            await page.type('#script_description', 'Automated publish from GitHub Actions', { delay: 10 });

            // Set code
            await page.evaluate((code) => {
                const ta = document.querySelector('textarea#script_code');
                if (ta) ta.value = code;
                const editor = document.querySelector('.CodeMirror');
                if (editor && editor.CodeMirror) {
                    editor.CodeMirror.setValue(code);
                }
            }, scriptContent);

            // Submit
            await Promise.all([
                page.click('button[type="submit"]'),
                page.waitForNavigation({ waitUntil: 'networkidle2' }),
            ]);
            console.log('Create finished, current URL:', page.url());
        }

        // On success, greedy page should redirect to script page
        console.log('Publish attempt finished, current URL:', page.url());

        await browser.close();
        process.exit(0);
    } catch (err) {
        console.error('Upload failed', err);
        await browser.close();
        process.exit(1);
    }
})();
