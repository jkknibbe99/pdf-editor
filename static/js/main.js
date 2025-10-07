let tokenClient;
let accessToken = null;
let pickerInited = false;
let gisInited = false;


/**
 * Google Picker API setup
 */

// Use the API Loader script to load google.picker.
function onApiLoad() {
    gapi.load('picker', () => { pickerInited = true; });
}


// Runs when the Google Identity Services library is loaded.
function onGisLoad() {
    // Replace with your client ID and required scopes.
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: '175573797619-c2pe8t5k6opqmmc89feo4gt3720lk471.apps.googleusercontent.com',
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        callback: '', // defined later
    });
    gisInited = true;
}


// Create and render a Google Picker object for selecting from Drive.
async function createPicker() {
    const res = await fetch("/get-access-token");
    const { access_token } = await res.json();

    const picker = new google.picker.PickerBuilder()
        .addView(google.picker.ViewId.PDFS)
        .enableFeature(google.picker.Feature.NAV_HIDDEN)
        .setOAuthToken(access_token)
        .setDeveloperKey(PICKER_API_KEY)
        .setCallback(pickerCallback)
        .setAppId(APP_ID)
        .build();
    picker.setVisible(true);
}


// A callback implementation.
async function pickerCallback(data) {
    document.getElementById('result').textContent = data[google.picker.Response.ACTION];
    if (data[google.picker.Response.ACTION] == google.picker.Action.PICKED) {
        const doc = data[google.picker.Response.DOCUMENTS][0];
        const file_id = doc[google.picker.Document.ID];
        const pdf_file = await fetch(`${download_url}${file_id}`);
        display_pdf(pdf_file, document.querySelector('#pdf-canvas'));
    }
}
