const API_BASE_URL = 'https://api.wanikani.com/v2/'


const relevantVocabEntries = []


async function fetchWaniKaniData(token, endpoint, params = {}) {
    const headers = new Headers({
        'Authorization': `Bearer ${token}`,
        'Wanikani-Revision': '20170710'
    });

    const urlParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        urlParams.append(key, value)
    });

    let allResponseData = [];
    let nextUrl = `${API_BASE_URL}${endpoint}?${urlParams.toString()}`;

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

function reportError(error) {
    document.getElementById('results-container').innerHTML = `<p style="color: red;">Error: ${error.message}.</p>`;
    console.error(error);
}

document.getElementById('fetch-button').addEventListener('click', async () => {
    const token = document.getElementById('api-token').value.trim();

    if (!token) {
        alert('Please enter your WaniKani API v2 Token.');
        return;
    }

    let assignments = [];
    try {
        assignments = await fetchWaniKaniData(
            token,
            'assignments',
            { srs_stage: '1,2,3,4,5,6,7,8,9' },
        );
    } catch (error) {
        reportError(error)
        return;
    }

    const vocab_assignments = assignments.filter(
        element => element.data.subject_type === "vocabulary" || element.data.subject_type === "kana_vocabulary"
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
            vocab = await fetchWaniKaniData(
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
    console.log(vocab);

    relevantVocabEntries.length = 0
    relevantVocabEntries.push(...vocab)

    alert(`Successfully fetched ${relevantVocabEntries.length} vocabulary entries`)
});

const resultsContainer = document.getElementById('results-container');
document.getElementById('random-button').addEventListener('click', async () => {
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
        <p class="sentence-jp">${sentence.ja}</p>
        <p class="sentence-en">${sentence.en}</p>
    `;
    resultsContainer.appendChild(vocabEntry);
});
