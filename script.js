// Globals
const WK_API_BASE_URL = 'https://api.wanikani.com/v2/'
const TTS_API_BASE_URL = 'https://deprecatedapis.tts.quest/v2/voicevox/audio/'
const relevantVocabEntries = []
const currentRandomSentence = {}


// Functions
function reportError(error) {
    document.getElementById('results-container').innerHTML = `<p style="color: red;">Error: ${error.message}.</p>`;
    console.error(error);
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
    relevantVocabEntries.forEach(entry => {
        entry.data.context_sentences.forEach(sentence => {
            html += `
                <p class="sentence-jp">${sentence.ja}</p>
                <p class="sentence-en">${sentence.en}</p>
                <hr>
            `;
        });
    });
    container.innerHTML = html;
}


async function fetchWaniKani() {
    const token = document.getElementById('wk-api-token').value.trim();

    if (!token) {
        alert('Please enter your WaniKani API v2 Token.');
        return;
    }
    localStorage.setItem("WK_API_KEY", token)

    let assignments = [];
    try {
        assignments = await _wkApiRequest(
            token,
            'assignments',
        );
    } catch (error) {
        reportError(error)
        return;
    }

    const vocab_assignments = assignments.filter(
        element => (
            element.data.subject_type === "vocabulary"
            || element.data.subject_type === "kana_vocabulary"
        ) && element.data.srs_stage > 0
    );
    const subjectIds = vocab_assignments.map(element => element.data.subject_id);
    console.log("filtered assignments:", subjectIds.length);

    const cachedEntries = [];
    const remainingIds = [];

    subjectIds.forEach(id => {
        const cachedData = localStorage.getItem(`subjectId_${id}`);
        if (cachedData) {
            cachedEntries.push(JSON.parse(cachedData));
        } else {
            remainingIds.push(id);
        }
    });
    console.log("found in cache:", cachedEntries.length);

    let vocab = [];
    if (remainingIds.length > 0) {
        try {
            vocab = await _wkApiRequest(
                token,
                "subjects",
                { ids: remainingIds.join(",") },
            )
        } catch (error) {
            reportError(error);
            return;
        }
    }

    console.log("received vocabulary:", vocab.length);
    vocab.forEach(element => {
        localStorage.setItem(`subjectId_${element.id}`, JSON.stringify(element))
    });

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
    localStorage.setItem('LAST_VOCABULARY', JSON.stringify(relevantVocabEntries));
    updateStatusContainer();
}


function getRandomSentence() {
    const resultsContainer = document.getElementById('results-container');
    if (relevantVocabEntries.length === 0) {
        alert("Collect vocabulary data first!")
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

    vocabEntry.innerHTML = `
        <div class="spoiler-bg"><p class="spoiler hidden vocabulary-jp">${entry.data.slug}</p></div>
        <div class="spoiler-bg"><p class="spoiler hidden sentence-jp">${sentence.ja}</p></div>
        <div class="spoiler-bg"><p class="spoiler hidden sentence-en">${sentence.en}</p></div>
    `;
    resultsContainer.appendChild(vocabEntry);
    currentRandomSentence.slug = entry.data.slug;
    currentRandomSentence.ja = sentence.ja;
    currentRandomSentence.en = sentence.en;
}


function _initializeGlobalsFromCache() {
    const wk_token = localStorage.getItem("WK_API_KEY");
    if (wk_token) {
        document.getElementById('wk-api-token').value = wk_token;
    }
    const tts_token = localStorage.getItem("TTS_API_KEY");
    if (tts_token) {
        document.getElementById('tts-api-token').value = tts_token;
    }
    const _last_vocab = localStorage.getItem("LAST_VOCABULARY");
    if (_last_vocab) {
        relevantVocabEntries.length = 0
        relevantVocabEntries.push(...JSON.parse(_last_vocab))
        updateStatusContainer();
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
        alert("Pick random sentence first.")
        return
    }

    const text = currentRandomSentence.ja;
    let voiceBase64 = localStorage.getItem(`TTS_${text}`)

    if (!voiceBase64) {
        const token = document.getElementById('tts-api-token').value.trim();
        if (!token) {
            alert('Please enter your TTS API Token.');
            return;
        }
        localStorage.setItem("TTS_API_KEY", token);

        const data = new URLSearchParams();
        data.append('text', text);
        data.append('key', token);

        const response = await fetch(
            TTS_API_BASE_URL,
            {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: data.toString(),
            },
        );
        if (!response.ok) {
            console.error('TTS response was not ok ' + response.statusText);
            return;
        }
        voiceBase64 = await blobToBase64(await response.blob());
        localStorage.setItem(`TTS_${text}`, voiceBase64);
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


// Initialization
document.getElementById('fetch-button').addEventListener('click', fetchWaniKani);
document.getElementById('random-button').addEventListener('click', getRandomSentence);
document.getElementById('voice-button').addEventListener('click', generateVoice);
_initializeGlobalsFromCache();
