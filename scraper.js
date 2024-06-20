const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const express = require('express');
const winston = require('winston');
const app = express();
const port = 3000;

puppeteer.use(StealthPlugin());

const LOG = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.Console({
            format: winston.format.simple()
        })
    ]
});

const jakusha_ID_ATTR = 'data-jakusha-id';
const RESERVED_ATTRIBUTES = new Set([
    'accept', 'alt', 'aria-checked', 'aria-current', 'aria-label', 'aria-required', 'aria-role',
    'aria-selected', 'checked', 'data-original-title', 'data-ui', 'for', 'href', 'maxlength',
    'name', 'pattern', 'placeholder', 'readonly', 'required', 'selected', 'src', 'text-value',
    'title', 'type', 'value'
]);

const loadDomUtils = async () => {
    const filePath = path.join(__dirname, 'domUtils.js');
    return fs.promises.readFile(filePath, 'utf8');
};

const removeWhitespace = (text) => {
    return text.replace(/\s+/g, ' ').trim();
};

const getAllVisibleText = async (page) => {
    return await page.evaluate(() => document.body.innerText);
};

const extractElements = async (page) => {
    return await page.evaluate(() => {
        return Array.from(document.querySelectorAll('*')).map(el => {
            const attributes = {};
            Array.from(el.attributes).forEach(attr => {
                attributes[attr.name] = attr.value;
            });
            return { id: el.dataset.uniqueId, tagName: el.tagName.toLowerCase(), attributes: attributes };
        });
    });
};

const buildAttribute = (key, value) => {
    if (typeof value === 'boolean' || typeof value === 'number') {
        return `${key}="${String(value).toLowerCase()}"`;
    }
    return value ? `${key}="${String(value)}"` : key;
};

const jsonToHtml = (element) => {
    const attributes = { ...element.attributes };

    ELEMENT_NODE_ATTRIBUTES.forEach(attr => {
        if (element[attr]) {
            attributes[attr] = element[attr];
        }
    });

    const attributesHtml = Object.entries(attributes)
        .map(([key, value]) => buildAttribute(key, value))
        .join(' ');

    const tag = element.tagName;
    const text = element.text || '';
    const childrenHtml = (element.children || []).map(jsonToHtml).join('');
    const optionHtml = (element.options || [])
        .map(option => `<option index="${option.optionIndex}">${option.text}</option>`)
        .join('');

    if (['img', 'input', 'br', 'hr', 'meta', 'link'].includes(tag)) {
        return `<${tag}${attributesHtml ? ' ' + attributesHtml : ''}>`;
    } else {
        return `<${tag}${attributesHtml ? ' ' + attributesHtml : ''}>${text}${childrenHtml}${optionHtml}</${tag}>`;
    }
};

class ElementTreeFormat {
    static JSON = 'json';
    static HTML = 'html';
}

class ScrapedPage {
    constructor(elements, idToXpathDict, idToElementDict, idToFrameDict, elementTree, elementTreeTrimmed, screenshots, url, html, extractedText = null) {
        this.elements = elements;
        this.idToXpathDict = idToXpathDict;
        this.idToElementDict = idToElementDict;
        this.idToFrameDict = idToFrameDict;
        this.elementTree = elementTree;
        this.elementTreeTrimmed = elementTreeTrimmed;
        this.screenshots = screenshots;
        this.url = url;
        this.html = html;
        this.extractedText = extractedText;
    }

    buildElementTree(format = ElementTreeFormat.JSON) {
        if (format === ElementTreeFormat.JSON) {
            return JSON.stringify(this.elementTreeTrimmed);
        } else if (format === ElementTreeFormat.HTML) {
            return this.elementTreeTrimmed.map(jsonToHtml).join('');
        } else {
            throw new Error(`Unknown element tree format: ${format}`);
        }
    }
}

const scrapeWebsite = async (browser, url, numRetry = 0) => {
    try {
        numRetry++;
        return await scrapeWebUnsafe(browser, url);
    } catch (err) {
        const MAX_SCRAPING_RETRIES = 2; // adjust as needed
        if (numRetry > MAX_SCRAPING_RETRIES) {
            LOG.error('Scraping failed after max retries, aborting.', { maxRetries: MAX_SCRAPING_RETRIES, url, err });
            throw new Error('Scraping failed.');
        }
        LOG.info('Scraping failed, will retry', { error: err.message, numRetry, url });
        return scrapeWebsite(browser, url, numRetry);
    }
};

const scrapeWebUnsafe = async (browser, url) => {
    const page = await browser.newPage();
    try {
        LOG.info('Navigating to URL', { url });
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
        LOG.info('Waiting for 5 seconds before scraping the website.');
        await new Promise(resolve => setTimeout(resolve, 5000));
        await page.evaluate(await loadDomUtils());

        const screenshots = [];
        let scrollYOld = -30;
        let scrollY = await scrollToTop(page, true);

        const MAX_NUM_SCREENSHOTS = 10;

        while (Math.abs(scrollYOld - scrollY) > 25 && screenshots.length < MAX_NUM_SCREENSHOTS) {
            const screenshot = await page.screenshot({ fullPage: false });
            screenshots.push(screenshot);
            scrollYOld = scrollY;
            LOG.info('Scrolling to next page', { url, numScreenshots: screenshots.length });
            scrollY = await scrollToNextPage(page, true);
            LOG.info('Scrolled to next page', { scrollY, scrollYOld });
        }

        await removeBoundingBoxes(page);
        await scrollToTop(page, false);

        const [elements, elementTree] = await getInteractableElementTree(page);

        if (!Array.isArray(elements) || !Array.isArray(elementTree)) {
            throw new Error('Invalid element tree structure');
        }

        const cleanedElementTree = cleanupElements([...elementTree]);

        buildElementLinks(elements);

        const idToXpathDict = {};
        const idToElementDict = {};
        const idToFrameDict = {};

        for (const element of elements) {
            const elementId = element.id;
            idToXpathDict[elementId] = `//*[@${jakusha_ID_ATTR}='${elementId}']`;
            idToElementDict[elementId] = element;
            idToFrameDict[elementId] = element.frame;
        }

        const textContent = await getFrameText(page.mainFrame());

        return new ScrapedPage(
            elements,
            idToXpathDict,
            idToElementDict,
            idToFrameDict,
            elementTree,
            trimElementTree([...elementTree]),
            screenshots,
            page.url(),
            await page.content(),
            textContent
        );
    } catch (error) {
        LOG.error('Failed to scrape the website', { error });
        throw error;
    } finally {
        await page.close();
    }
};

const getInteractableElementTree = async (page) => {
    const result = await page.evaluate(async () => {
        const result = await buildTreeFromBody("main.frame", true);
        console.log("Result from buildTreeFromBody:", result);
        return result;
    });

    if (!Array.isArray(result) || result.length !== 2 || !Array.isArray(result[0]) || !Array.isArray(result[1])) {
        throw new Error('Invalid element tree structure');
    }

    return result;
};

const scrollToTop = async (page, drawBoxes) => {
    const jsScript = `async () => await scrollToTop(${drawBoxes})`;
    return await page.evaluate(jsScript);
};

const scrollToNextPage = async (page, drawBoxes) => {
    const jsScript = `async () => await scrollToNextPage(${drawBoxes})`;
    return await page.evaluate(jsScript);
};

const removeBoundingBoxes = async (page) => {
    const jsScript = '() => removeBoundingBoxes()';
    await page.evaluate(jsScript);
};

const cleanupElements = (elements) => {
    const queue = [...elements];
    while (queue.length) {
        const element = queue.shift();
        delete element.rect;
        if (element.children) {
            queue.push(...element.children);
        }
    }
    return elements;
};

const buildElementLinks = (elements) => {
    const textToElementsMap = new Map();
    const contextToElementsMap = new Map();

    elements.forEach(element => {
        if (element.text) {
            if (!textToElementsMap.has(element.text)) {
                textToElementsMap.set(element.text, []);
            }
            textToElementsMap.get(element.text).push(element);
        }
        if (element.context) {
            if (!contextToElementsMap.has(element.context)) {
                contextToElementsMap.set(element.context, []);
            }
            contextToElementsMap.get(element.context).push(element);
        }
    });

    elements.forEach(element => {
        if (element.attributes && element.attributes.role === 'listbox') {
            const listboxText = element.text || '';
            for (const [text, linkedElements] of textToElementsMap.entries()) {
                if (text.includes(listboxText)) {
                    linkedElements.forEach(linkedElement => {
                        if (linkedElement.id !== element.id) {
                            linkedElement.linked_element = element.id;
                        }
                    });
                }
            }
            for (const [context, linkedElements] of contextToElementsMap.entries()) {
                if (context.includes(listboxText)) {
                    linkedElements.forEach(linkedElement => {
                        if (linkedElement.id !== element.id) {
                            linkedElement.linked_element = element.id;
                        }
                    });
                }
            }
        }
    });
};

const getFrameText = async (frame) => {
    const jsScript = '() => document.body.innerText';
    let text = '';
    try {
        text = await frame.evaluate(jsScript);
    } catch (err) {
        LOG.warn('Failed to get text from iframe', { err });
        return '';
    }
    for (const childFrame of frame.childFrames()) {
        if (!childFrame.isDetached()) {
            text += await getFrameText(childFrame);
        }
    }
    return text;
};

const trimElementTree = (elements) => {
    const queue = [...elements];
    while (queue.length) {
        const element = queue.shift();
        if (element.frame) delete element.frame;
        if (!element.interactable) delete element.id;
        if (element.attributes) {
            const newAttributes = trimmedAttributes(element.tagName, element.attributes);
            if (Object.keys(newAttributes).length) {
                element.attributes = newAttributes;
            } else {
                delete element.attributes;
            }
        }
        if (element.children) {
            queue.push(...element.children);
            if (!element.children.length) delete element.children;
        }
        if (element.text) {
            if (!element.text.trim()) delete element.text;
        }
    }
    return elements;
};

const trimmedAttributes = (tagName, attributes) => {
    const newAttributes = {};
    for (const [key, value] of Object.entries(attributes)) {
        if ((key === 'id' && ['input', 'textarea', 'select'].includes(tagName)) || (key === 'role' && ['listbox', 'option'].includes(value)) || (RESERVED_ATTRIBUTES.has(key) && value)) {
            newAttributes[key] = value;
        }
    }
    return newAttributes;
};

const saveDataAsJson = async (url, data) => {
    const hostname = new URL(url).hostname;
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const filename = `${hostname}-${timestamp}.json`;
    const filepath = path.join(__dirname, filename);
    const fileContents = JSON.stringify(data, null, 2);

    try {
        await fs.promises.writeFile(filepath, fileContents, 'utf8');
        LOG.info(`Data saved to ${filepath}`);
    } catch (error) {
        LOG.error(`Error saving data locally: ${error.message}`);
    }
};

app.use(express.static('public'));
app.get('/health', (req, res) => {
    res.sendStatus(200);
});

app.get('/scrape', async (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).send('URL parameter is missing');
    }
    const browser = await puppeteer.launch({ headless: false });
    try {
        await scrapeWebsite(browser, url);
        res.send('Scrape completed successfully');
    } catch (error) {
        res.status(500).send(`Error during scraping: ${error.message}`);
    } finally {
        await browser.close();
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

// Example of using the scrapeWebsite function directly
(async () => {
    const url = process.argv[2];
    if (!url) {
        console.error('Please provide a URL as a command line argument');
        process.exit(1);
    }

    const browser = await puppeteer.launch({ headless: false });
    try {
        const scrapedPage = await scrapeWebsite(browser, url);
        console.log(scrapedPage.buildElementTree(ElementTreeFormat.JSON));
    } catch (error) {
        console.error('Failed to scrape the website:', error);
    } finally {
        await browser.close();
    }
})();
