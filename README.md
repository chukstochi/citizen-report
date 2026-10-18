# Citizen Report (Cordova + App.js)

1. Put the three App.js files in `www/lib/` (see `www/lib/PUT-APPJS-FILES-HERE.txt`): app.min.css, app.min.js, zepto.min.js.
2. Backend: `cd backend`, `python -m venv .venv`, `.venv\Scripts\activate`, `pip install -r requirements.txt`, `uvicorn main:app --reload --host 0.0.0.0`
3. App in the browser: `cd www`, `python -m http.server 5500`, open http://localhost:5500 (login: demo / demo1234)
4. For the APK: host the backend online first and set its https address in `www/js/config.js`, then in the folder with config.xml:
```
npm install -g cordova
cordova platform add android
cordova plugin add cordova-plugin-geolocation
cordova plugin add cordova-plugin-local-notification   (optional)
cordova build android
```
APK: `platforms/android/app/build/outputs/apk/debug/app-debug.apk`
