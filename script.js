// Globals
const MESSAGE_TIMEOUT = 5000;
const WK_API_BASE_URL = 'https://api.wanikani.com/v2/';
const TTS_API_BASE_URL = 'https://deprecatedapis.tts.quest/v2/voicevox/audio/';
const DUCK_AI_BASE_URL = 'https://duckduckgo.com/?q={query}&ia=chat&bang=true';
const DUCK_AI_PROMPT_TEMPLATE = `Please break down the following Japanese sentence:

{sentence}

 - Explain the meaning of each component.
 - Describe the grammatical structure.
 - Explain any conjugations used.
`;
const relevantVocabEntries = [];
const currentRandomSentence = {};


// Functions
function reportError(error) {
    showStatusMessage(`Error: ${error.message}.`, 'error');
    console.error(error);
}


function showStatusMessage(message, type) {
    const statusMessagesDiv = document.getElementById('status-messages-host');
    const messageElement = document.createElement('div');

    messageElement.innerText = message;
    messageElement.className = `status-message ${type}`;

    statusMessagesDiv.appendChild(messageElement);
    setTimeout(() => {messageElement.style.opacity = 1;}, 10);
    setTimeout(() => {messageElement.style.opacity = 0;}, MESSAGE_TIMEOUT);
    setTimeout(() => {
        messageElement.style.display = 'none';
        statusMessagesDiv.removeChild(messageElement);
    }, 2 * MESSAGE_TIMEOUT);
    console.log("msg shown:", message, type)
}


async function _wkApiRequest(token, endpoint, params = {}) {
    const headers = new Headers({
        'Authorization': `Bearer ${token}`,
        'Wanikani-Revision': '20170710'
    });

    const urlParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        urlParams.append(key, value)
    });

    let allResponseData = [];
    let nextUrl = `${WK_API_BASE_URL}${endpoint}?${urlParams.toString()}`;

    while (nextUrl) {
        const response = await fetch(nextUrl, { headers });
        if (!response.ok) {
            throw new Error(`API Request Failed: ${response.status} - ${response.statusText}`);
        }
        const data = await response.json();
        allResponseData = allResponseData.concat(data.data);
        nextUrl = data.pages.next_url;
    }

    return allResponseData;
}


function updateStatusContainer() {
    const container = document.getElementById("active-vocab-container");
    let html = "";
    let numSentences = 0;
    relevantVocabEntries.forEach(entry => {
        entry.data.context_sentences.forEach(sentence => {
            html += `
                <p class="sentence-jp">${sentence.ja}</p>
                <p class="sentence-en">${sentence.en}</p>
                <hr>
            `;
            numSentences += 1;
        });
    });
    container.innerHTML = html;
    showStatusMessage(
        `Loaded ${relevantVocabEntries.length} vocabulary words, ${numSentences} context sentences.`,
        relevantVocabEntries.length > 0 ? "success" : "error",
    );
}


async function fetchWaniKani() {
    const token = document.getElementById('wk-api-token').value.trim();

    if (!token) {
        showStatusMessage("Please enter your WaniKani API v2 Token.", 'error');
        return;
    }
    await localforage.setItem("WK_API_KEY", token)

    showLoadingMessage("Fetching WaniKani assignments...");
    let assignments = [];
    try {
        assignments = await _wkApiRequest(
            token,
            'assignments',
        );
    } catch (error) {
        reportError(error)
        return;
    } finally {
        hideLoadingMessage();
    }

    const vocab_assignments = assignments.filter(
        element => (
            element.data.subject_type === "vocabulary"
            || element.data.subject_type === "kana_vocabulary"
        ) && element.data.srs_stage > 0
    );
    const subjectIds = vocab_assignments.map(element => element.data.subject_id);
    console.log("filtered assignments:", subjectIds.length);

    const cacheQuery = await Promise.all(
        subjectIds.map(
            async (id) => {
                let obj = await localforage.getItem(`subjectId_${id}`);
                if (!obj) return { cacheStatus: "missing", id: id };
                return { cacheStatus: "found", obj: JSON.parse(obj)};
            }
        )
    );
    const remainingIds = cacheQuery.filter(entry => entry.cacheStatus === "missing").map(entry => entry.id);
    const cachedEntries = cacheQuery.filter(entry => entry.cacheStatus === "found").map(entry => entry.obj);
    console.log("found in cache:", cachedEntries.length);

    let vocab = [];
    if (remainingIds.length > 0) {
        showLoadingMessage("Fetching WaniKani vocabulary...");
        try {
            vocab = await _wkApiRequest(
                token,
                "subjects",
                { ids: remainingIds.join(",") },
            )
        } catch (error) {
            reportError(error);
            return;
        } finally {
            hideLoadingMessage();
        }

        console.log("received vocabulary:", vocab.length);
        await Promise.all(
            vocab.map(async element => {
                await localforage.setItem(`subjectId_${element.id}`, JSON.stringify(element));
            })
        );
    }


    vocab = cachedEntries.concat(vocab);
    console.log("total vocab:", vocab.length);

    const levels = document.getElementById("level-filter").value
        .trim()
        .split(',')
        .filter(x => x.trim())
        .map(Number)
        .filter(num => Number.isInteger(num));

    if (levels.length > 0) {
        vocab = vocab.filter(entry => levels.includes(entry.data.level));
        console.log("remaining vocab after filter", levels, "applied:", vocab.length);
    }

    relevantVocabEntries.length = 0;
    relevantVocabEntries.push(...vocab);
    await localforage.setItem('LAST_VOCABULARY', JSON.stringify(relevantVocabEntries));
    updateStatusContainer();
}


function getRandomSentence() {
    const resultsContainer = document.getElementById('results-container');
    if (relevantVocabEntries.length === 0) {
        showStatusMessage("Please collect vocabulary data first!", 'error');
        return
    }

    let entry = { data: { context_sentences: [] } }
    while (entry.data.context_sentences.length === 0) {
        entry = relevantVocabEntries[Math.floor(Math.random() * relevantVocabEntries.length)]
    }
    const sentence = entry.data.context_sentences[
        Math.floor(Math.random() * entry.data.context_sentences.length)
    ]

    resultsContainer.innerHTML = '';
    const vocabEntry = document.createElement('div');
    vocabEntry.className = 'vocab-entry';

    const chatBotLink = createDuckDuckGoLink(sentence.ja);

    vocabEntry.innerHTML = `
        <div class="spoiler-bg"><p class="spoiler hidden vocabulary-jp">${entry.data.slug}</p></div>
        <div class="spoiler-bg"><p class="spoiler hidden sentence-jp">${sentence.ja}</p></div>
        <div class="spoiler-bg"><p class="spoiler hidden sentence-en" style="margin-bottom: 4px;">${sentence.en}</p></div>
        <p style="font-size: x-small; margin-top: 0; margin-bottom: 4px;"><a class="duck-ai-link" href="${chatBotLink}" target="_blank">→ ask duck.ai to explain (external link)</a></p>
    `;
    resultsContainer.appendChild(vocabEntry);
    currentRandomSentence.slug = entry.data.slug;
    currentRandomSentence.ja = sentence.ja;
    currentRandomSentence.en = sentence.en;
}


async function _initializeGlobalsFromCache() {
    showLoadingMessage("Initializing...");
    try {
        const wk_token = await localforage.getItem("WK_API_KEY");
        if (wk_token) {
            document.getElementById('wk-api-token').value = wk_token;
        }
        const tts_token = await localforage.getItem("TTS_API_KEY");
        if (tts_token) {
            document.getElementById('tts-api-token').value = tts_token;
        }
        const _last_vocab = await localforage.getItem("LAST_VOCABULARY");
        if (_last_vocab) {
            relevantVocabEntries.length = 0
            relevantVocabEntries.push(...JSON.parse(_last_vocab))
            updateStatusContainer();
        }
    } finally {
        hideLoadingMessage();
    }
}


function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}


async function base64ToBlob(base64) {
    const response = await fetch(base64);
    return response.blob();
}


async function generateVoice() {
    if (!currentRandomSentence.ja) {
        showStatusMessage("Please pick random sentence first.", 'error');
        return
    }

    const text = currentRandomSentence.ja;
    let voiceBase64 = await localforage.getItem(`TTS_audio_${text}`)

    if (!voiceBase64) {
        const token = document.getElementById('tts-api-token').value.trim();
        if (!token) {
            showStatusMessage("Please enter your TTS API Token.", 'error');
            return;
        }
        await localforage.setItem("TTS_API_KEY", token);

        const data = new URLSearchParams();
        data.append('text', text);
        data.append('key', token);

        showLoadingMessage("Generating voice...");
        try {
            const response = await fetch(
                TTS_API_BASE_URL,
                {
                    method: 'POST',
                    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                    body: data.toString(),
                },
            );
            if (!response.ok) {
                throw new Error(`API Request Failed: ${response.status} - ${response.statusText}`);
            }
            voiceBase64 = await blobToBase64(await response.blob());
            await localforage.setItem(`TTS_audio_${text}`, voiceBase64);
        } catch (error) {
            reportError(error);
            return;
        } finally {
            hideLoadingMessage();
        }
    }

    await (
        base64ToBlob(voiceBase64)
        .then(blob => {
            const audioUrl = URL.createObjectURL(blob);
            const audio = new Audio(audioUrl);
            audio.play();
            audio.onended = () => URL.revokeObjectURL(audioUrl);
        })
        .catch(error => console.error('Error playing audio:', error))
    );
}


function getAllUIElements() {
    return Array.from(document.querySelectorAll('button, input')).filter(
        element => !element.classList.contains('panel-toggle-btn')
    );
}


function showLoadingMessage(message) {
    const uiElements = getAllUIElements();
    uiElements.forEach(element => element.classList.add('disabled-ui-element'));

    const msgContainer = document.getElementById("loading-message");
    msgContainer.innerHTML = message;
    msgContainer.classList.add('show');
}


function hideLoadingMessage() {
    const uiElements = getAllUIElements();
    uiElements.forEach(element => element.classList.remove('disabled-ui-element'));

    const msgContainer = document.getElementById("loading-message");
    msgContainer.innerHTML = "";
    msgContainer.classList.remove('show');
}


async function clearCachedAudio() {
    showLoadingMessage("Cleaning up audio cache...");
    try {
        const keys = (await localforage.keys()).filter(k => k.startsWith("TTS_audio"));
        await Promise.all(
            keys.map(async k => await localforage.removeItem(k))
        );
        showStatusMessage(`Cleaned up ${keys.length} entries.`, "success");
    } finally {
        hideLoadingMessage();
    }
}


function createDuckDuckGoLink(phraseJap) {
    const customMessage = DUCK_AI_PROMPT_TEMPLATE.replace("{sentence}", phraseJap);
    const encodedMessage = encodeURIComponent(customMessage);
    const completeURL = DUCK_AI_BASE_URL.replace("{query}", encodedMessage);
    return completeURL;
}


// Initialization
document.getElementById('fetch-button').addEventListener('click', fetchWaniKani);
document.getElementById('random-button').addEventListener('click', getRandomSentence);
document.getElementById('voice-button').addEventListener('click', generateVoice);
document.getElementById('clear-audio-button').addEventListener('click', clearCachedAudio)
_initializeGlobalsFromCache();
