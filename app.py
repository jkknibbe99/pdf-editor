from flask import Flask, render_template, url_for, redirect, request, session
import google.oauth2.credentials
import google_auth_oauthlib.flow
import googleapiclient.discovery
import os


app = Flask(__name__)
app.secret_key = 'dev-secret-key'  # Used for session cookies TODO: create strong key for prod

# Path to OAuth client secrets
CREDENTIALS_FILEPATH = 'oauthCredentials.json'

# Google Drive API scopes
SCOPES = ["https://www.googleapis.com/auth/drive.metadata.readonly"]


@app.route('/')
def index():
    if 'credentials' not in session:
        return '<a href="/auth">Authorize with Google</a>'
    
    # Load creds from session
    creds = google.oauth2.credentials.Credentials(**session['credentials'])
    drive = googleapiclient.discovery.build('drive', 'v3', credentials=creds)

    # EXAMPLE (list first 10 files) TODO: remove
    results = drive.files().list(pageSize=10, fields='files(id, name)').execute()
    files = results.get('files', [])

    # save updated credentials in session (refresh tokens etc.)
    session['credentials'] = creds_to_dict(creds)

    return render_template('index.html', files=files)


@app.route('/auth')
def aut():
    flow = google_auth_oauthlib.flow.Flow.from_client_secrets_file(
        CREDENTIALS_FILEPATH, scopes=SCOPES
    )
    flow.redirect_uri = url_for('oauthCallback', _external=True)
    authorization_url, state = flow.authorization_url(access_type='offline', include_granted_scopes='true')
    session['state'] = state
    return redirect(authorization_url)


@app.route('/oauthCallback')
def oauthCallback():
    state = session['state']
    flow = google_auth_oauthlib.flow.Flow.from_client_secrets_file(CREDENTIALS_FILEPATH, scopes=SCOPES, state=state)
    flow.redirect_uri = url_for('oauthCallback', _external=True)
    authorization_response = request.url
    flow.fetch_token(authorization_response=authorization_response)
    creds = flow.credentials
    session['credentials'] = creds_to_dict(creds)
    return redirect(url_for('index'))


def creds_to_dict(creds):
    return {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": creds.scopes,
    }


if __name__ == '__main__':
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'  # Only for local dev over http. TODO: remove for prod
    app.run(port=5000, host='0.0.0.0', debug=True)
