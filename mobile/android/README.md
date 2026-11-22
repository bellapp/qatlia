# App Android QatliA (`com.qatlia.app`)

L'app du Play Store affiche qatlia.ma dans le navigateur du téléphone (Trusted Web Activity), ouvert sur `https://qatlia.ma/atelier?app=android`. Elle ne contient aucun écran à elle : un déploiement du site met l'app à jour. Conception : `docs/superpowers/specs/2026-11-14-app-mobile-design.md`, lot 2.

Le projet est généré par [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) 1.27.0 à partir de `twa-manifest.json`. On modifie `twa-manifest.json`, jamais les fichiers générés, sauf par `scripts/restrict-links.js`.

## Prérequis sur le PC

- JDK 17 et le SDK Android d'Android Studio, déclarés dans `~/.bubblewrap/config.json`. Le chemin du JDK ne doit pas contenir d'espace : Bubblewrap lance `java` sans guillemets pour signer, et « C:\Program Files » casse la commande. Un lien suffit :
  `New-Item -ItemType Junction -Path "$HOME\.qatlia\jdk-17" -Target "C:\Program Files\Eclipse Adoptium\jdk-17.0.14.7-hotspot"`
  puis `{"jdkPath":"C:/Users/<vous>/.qatlia/jdk-17","androidSdkPath":"C:/Users/<vous>/AppData/Local/Android/Sdk"}`
- Bubblewrap recopie les mots de passe en clair dans ses messages d'erreur : ne collez jamais la sortie d'une construction ratée sans la relire.
- Bubblewrap cherche un dossier `bin` à la racine du SDK, absent de celui d'Android Studio. Un lien suffit :
  `mklink /J %LOCALAPPDATA%\Android\Sdk\bin %LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest\bin`
- Outils de construction `36.1.0` : `sdkmanager "build-tools;36.1.0"`.

## Clé d'envoi

La clé d'envoi signe les fichiers envoyés au Play Console ; Google re-signe ensuite l'app avec sa propre clé. **Elle ne va jamais dans le dépôt** (`*.jks` est ignoré). Elle vit dans `C:/Users/zbook/.qatlia/android/qatlia-upload.jks`, alias `upload`. Sauvegardez ce fichier et son mot de passe hors du PC. Une clé perdue se remplace depuis le Play Console, mais cela prend plusieurs jours.

Création (une seule fois, le mot de passe est demandé deux fois) :

```powershell
New-Item -ItemType Directory -Force "$HOME\.qatlia\android" | Out-Null
& "C:\Program Files\Eclipse Adoptium\jdk-17.0.14.7-hotspot\bin\keytool.exe" -genkeypair -v -keystore "$HOME\.qatlia\android\qatlia-upload.jks" -alias upload -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=QatliA, O=QatliA, C=MA"
```

## Construire une version pour le Play Console

1. Montez `appVersionCode` (+1) et `appVersion` dans `twa-manifest.json` si une version a déjà été envoyée.
2. Si `twa-manifest.json` a changé, régénérez puis réappliquez la retouche des liens :
   ```powershell
   npx @bubblewrap/cli@1.27.0 update --skipVersionUpgrade
   node scripts/restrict-links.js
   ```
3. Construisez et signez (les deux mots de passe sont demandés) :
   ```powershell
   npx @bubblewrap/cli@1.27.0 build --skipPwaValidation
   ```
4. Envoyez `app-release-bundle.aab` au Play Console.

## Liens ouverts dans l'app

`scripts/restrict-links.js` limite les liens que l'app ouvre à `/atelier`, `/history`, `/account` et `/panels` : un lien `qatlia.ma/credits` reçu par WhatsApp s'ouvre dans le navigateur, où l'achat reste possible. Bubblewrap n'a pas de réglage pour cela et efface la retouche à chaque `update` ; `tests/android-links.test.js` échoue si elle manque.

## Preuve de propriété du domaine

Sans `public/.well-known/assetlinks.json` sur qatlia.ma, listant l'empreinte SHA-256 de la clé de signature Play et celle de la clé d'envoi, l'app affiche une barre d'adresse. Les deux empreintes se lisent dans le Play Console, page « Intégrité de l'application ».
