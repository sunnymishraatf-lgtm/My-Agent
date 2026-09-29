#!/bin/bash
# NEUTRON APK builder — no Gradle needed, uses the Android SDK command-line tools.
# Requirements: JDK 17+, Android SDK with platform android-34 + build-tools 34.0.0.
#   export JAVA_HOME=~/jdk-17.0.20.1+1 ANDROID_HOME=~/android-sdk
# Usage: VERSION_CODE=3 VERSION_NAME=1.2 bash build.sh
set -e
APK_DIR="$(cd "$(dirname "$0")" && pwd)"
export JAVA_HOME="${JAVA_HOME:-$HOME/jdk-17.0.20.1+1}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
BT=$ANDROID_HOME/build-tools/34.0.0
AJAR=$ANDROID_HOME/platforms/android-34/android.jar
export PATH=$JAVA_HOME/bin:$BT:$PATH

VERSION_CODE="${VERSION_CODE:-2}"
VERSION_NAME="${VERSION_NAME:-1.1}"
OUT="${OUT:-$HOME/workspace/your_files/NEUTRON.apk}"

cd "$APK_DIR"
rm -rf build && mkdir -p build/gen build/classes

echo "== aapt2 compile =="
$BT/aapt2 compile --dir app/src/main/res -o build/res.zip

echo "== aapt2 link (v$VERSION_NAME, code $VERSION_CODE) =="
$BT/aapt2 link -o build/neutron-unsigned.apk \
  -I "$AJAR" \
  --manifest app/src/main/AndroidManifest.xml \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  build/res.zip

echo "== javac =="
javac -encoding UTF-8 -source 17 -target 17 -classpath "$AJAR" \
  -d build/classes $(find app/src/main/java -name "*.java")

echo "== d8 =="
mkdir -p build/dex
$BT/d8 --min-api 24 --lib "$AJAR" \
  --output build/dex $(find build/classes -name "*.class")

echo "== add dex =="
python3 - "$APK_DIR" <<'EOF'
import sys, zipfile, glob
apk_dir = sys.argv[1]
dex = glob.glob(f"{apk_dir}/build/dex/classes*.dex")
zin = f"{apk_dir}/build/neutron-unsigned.apk"
zout = f"{apk_dir}/build/neutron-unaligned.apk"
with zipfile.ZipFile(zin) as zi, zipfile.ZipFile(zout, "w", zipfile.ZIP_DEFLATED) as zo:
    for item in zi.infolist():
        zo.writestr(item, zi.read(item.filename))
    for d in dex:
        zo.write(d, "classes.dex" if len(dex) == 1 else d.split("/")[-1])
print("dex added:", dex)
EOF

echo "== zipalign =="
$BT/zipalign -f 4 build/neutron-unaligned.apk build/neutron-aligned.apk

echo "== keystore =="
# The release keystore lives OUTSIDE build/ on purpose: build/ is wiped on
# every build, and losing this key would break all future updates
# (Android + IzzyOnDroid pin the signing certificate).
KS="$APK_DIR/keystore/neutron-release.keystore"
if [ ! -f "$KS" ]; then
  mkdir -p "$APK_DIR/keystore"
  keytool -genkeypair -keystore "$KS" -alias neutron \
    -storepass android -keypass android -keyalg RSA -keysize 2048 -validity 10950 \
    -dname "CN=NEUTRON, OU=App, O=NEUTRON, C=IN" 2>/dev/null
fi

echo "== apksigner =="
$BT/apksigner sign --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --out "$OUT" build/neutron-aligned.apk

echo "== verify =="
$BT/apksigner verify --print-certs "$OUT" | head -3
ls -la "$OUT"
