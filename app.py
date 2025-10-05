from flask import Flask, render_template, url_for, redirect, jsonify, request, session
import google.oauth2.credentials
import google_auth_oauthlib.flow
import googleapiclient.discovery
from googleapiclient.http import MediaIoBaseDownload
import requests
import io
import os


app = Flask(__name__)
app.secret_key = 'dev-secret-key'  # Used for session cookies TODO: create strong key for prod

# Path to OAuth client secrets
CREDENTIALS_FILEPATH = 'oauthCredentials.json'

# Google Drive API scopes
SCOPES = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
]

os.environ['OAUTHLIB_RELAX_TOKEN_SCOPE'] = '1'  # To allow token refresh with changed scopes. TODO: need to figure out better way to avoid warnings


@app.route('/')
def index():
    auth = False
    if 'credentials' in session:
        # Load creds from session
        creds = google.oauth2.credentials.Credentials(**session['credentials'])
        drive = googleapiclient.discovery.build('drive', 'v3', credentials=creds)
        # save updated credentials in session (refresh tokens etc.)
        session['credentials'] = creds_to_dict(creds)
        auth = True
    return render_template('index.html', auth=auth)


@app.route('/auth')
def auth():
    flow = google_auth_oauthlib.flow.Flow.from_client_secrets_file(CREDENTIALS_FILEPATH, scopes=SCOPES)
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


@app.route("/get-access-token")
def get_access_token():
    '''Get oauth access token. Refresh if necessary.'''
    if 'credentials' not in session:
        return jsonify({"error": "Not authorized"}), 401

    creds = google.oauth2.credentials.Credentials(**session['credentials'])

    # Refresh if expired
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        session['credentials'] = creds_to_dict(creds)

    return jsonify({"access_token": creds.token})


@app.route("/user_profile")
def user_profile():
    '''
    Gets current logged in user profile
    :return: JSON object with user info
    '''
    # Check for creds
    if "credentials" not in session:
        return redirect(url_for('auth'))
    creds = google.oauth2.credentials.Credentials(**session["credentials"])
    # Call Google’s Userinfo API
    resp = requests.get(
        "https://www.googleapis.com/oauth2/v1/userinfo",
        params={"alt": "json"},
        headers={"Authorization": f"Bearer {creds.token}"}
    )
    userinfo = resp.json()
    # Save updated credentials back
    session["credentials"] = creds_to_dict(creds)
    return jsonify({
        'name': userinfo.get('name'),
        'email': userinfo.get('email'),
        'picture': userinfo.get('picture')
    })


@app.route('/logout')
def logout():
    '''Logout route'''
    session.clear()
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


@app.route('/download/<file_id>')
def download_file(file_id: str):
    '''
    :param str file_id: Google Drive document ID
    :return: PDF file
    '''
    # Check for google oauth creds
    if 'credentials' not in session:
        return "Not authorized", 401
    # Create googleapi drive client
    creds = google.oauth2.credentials.Credentials(**session['credentials'])
    drive = googleapiclient.discovery.build('drive', 'v3', credentials=creds)
    # Download file
    request = drive.files().get_media(fileId=file_id)
    fh = io.BytesIO()
    downloader = MediaIoBaseDownload(fh, request)
    done = False
    while not done:
        status, done = downloader.next_chunk()
    # Return file
    fh.seek(0)
    return fh.read(), 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": f"inline; filename={file_id}.pdf"
    }


if __name__ == '__main__':
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'  # Only for local dev over http. TODO: remove for prod
    app.run(port=5000, host='0.0.0.0', debug=True)
