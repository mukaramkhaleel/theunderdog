const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const express = require('express');
const app = express();
const port = 3000;

puppeteer.use(StealthPlugin());

async function loadDomUtils() {
    const filePath = path.join(__dirname, 'domUtils.js');
    return fs.promises.readFile(filePath, 'utf8');
}

function removeWhitespace(text) {
    return text.replace(/\s+/g, ' ').trim();
}

async function getAllVisibleText(page) {
    const visibleText = await page.evaluate(() => document.body.innerText);
    return visibleText;
}

async function extractElements(page) {
    return await page.evaluate(() => {
        return Array.from(document.querySelectorAll('*')).map(el => {
            const attributes = {};
            Array.from(el.attributes).forEach(attr => {
                attributes[attr.name] = attr.value;
            });
            return { id: el.dataset.uniqueId, tagName: el.tagName.toLowerCase(), attributes: attributes };
        });
    });
}

async function scrapeWebUnsafe(url) {
    const browser = await puppeteer.launch({executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
    const page = await browser.newPage();
    try {
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
        await page.setRequestInterception(true);
        page.on('request', request => {
            ['image', 'stylesheet', 'font'].includes(request.resourceType()) ? request.abort() : request.continue();
        });
        const elements = await extractElements(page);
        elements.forEach(element => {
            if (element.attributes.title) {
                element.attributes.title = removeWhitespace(element.attributes.title);
            }
        });
        console.log(elements);
        const visibleText = await getAllVisibleText(page);
        console.log("Visible text:", visibleText);
        await saveDataAsJson(url, visibleText);
    } catch (error) {
        console.error('Timeout or navigation error:', error);
    } finally {
        await browser.close();
    }
}

async function saveDataAsJson(url, data) {
    const hostname = new URL(url).hostname;
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const filename = `${hostname}-${timestamp}.json`;
    const filepath = path.join(__dirname, filename);
    const fileContents = JSON.stringify(data, null, 2);

    try {
        await fs.promises.writeFile(filepath, fileContents, 'utf8');
        console.log(`Data saved to ${filepath}`);
    } catch (error) {
        console.error(`Error saving data locally: ${error.message}`);
    }
}

app.use(express.static('public'));
app.get('/health', (req, res) => {
    res.sendStatus(200);
});

app.get('/scrape', async (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).send('URL parameter is missing');
    }
    try {
        await scrapeWebUnsafe(url);
        res.send('Scrape completed successfully');
    } catch (error) {
        res.status(500).send(`Error during scraping: ${error.message}`);
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
