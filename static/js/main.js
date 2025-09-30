let tokenClient;
let accessToken = null;
let pickerInited = false;
let gisInited = false;


// Use the API Loader script to load google.picker.
function onApiLoad() {
    gapi.load('picker', onPickerApiLoad);
}


function onPickerApiLoad() {
    pickerInited = true;
}


function gisLoaded() {
    // Replace with your client ID and required scopes.
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: '175573797619-c2pe8t5k6opqmmc89feo4gt3720lk471.apps.googleusercontent.com',
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        callback: '', // defined later
    });
    gisInited = true;
}


// Create and render a Google Picker object for selecting from Drive.
function createPicker() {
    const showPicker = () => {
        // Replace with your API key and App ID.
        const picker = new google.picker.PickerBuilder()
            .addView(google.picker.ViewId.DOCS)
            .setOAuthToken(accessToken)
            .setDeveloperKey('AIzaSyDeKzHPZhFyL4S1EbBD58WpsxdRp3qUYgY')
            .setCallback(pickerCallback)
            .setAppId('pdf-editor-473716')
            .build();
        picker.setVisible(true);
    }

    // Request an access token.
    tokenClient.callback = async (response) => {
        if (response.error !== undefined) {
            throw (response);
        }
        accessToken = response.access_token;
        showPicker();
    };

    if (accessToken === null) {
        // Prompt the user to select a Google Account and ask for consent to share their data
        // when establishing a new session.
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        // Skip display of account chooser and consent dialog for an existing session.
        tokenClient.requestAccessToken({ prompt: '' });
    }
}


document.addEventListener("DOMContentLoaded", function () {
    document.querySelector('#openBtn').addEventListener('click', createPicker);
});