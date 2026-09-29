# NEUTRON Android app

Native WebView shell for the NEUTRON web app (MIT licensed, same as the repo).

- `app/src/main/` — Android source: `MainActivity` (WebView) + `UpdateManager`
  (self-updater: checks GitHub releases, downloads and installs updates —
  no Play Store needed).
- `build.sh` — builds a signed APK without Gradle (aapt2 + d8 + apksigner).

## Build

Needs JDK 17+ and the Android SDK (`platforms;android-34`, `build-tools;34.0.0`):

```bash
export JAVA_HOME=~/jdk-17.0.20.1+1 ANDROID_HOME=~/android-sdk
VERSION_CODE=2 VERSION_NAME=1.1 bash apk/build.sh   # writes ~/workspace/your_files/NEUTRON.apk
```

## Release process (self-updating)

1. Bump `VERSION_CODE` / `VERSION_NAME`, rebuild.
2. Create a GitHub release tagged `v<VERSION_CODE>` and attach `NEUTRON.apk`.
3. Installed apps check `api.github.com/repos/sunnymishraatf-lgtm/My-Agent/releases/latest`
   once a day and prompt to install the new APK.

## Permissions

- `INTERNET` / `ACCESS_NETWORK_STATE` — load the web app.
- `REQUEST_INSTALL_PACKAGES` — required for the self-updater's install step.
