// Aktuelle Android-App (die Hülle, nicht der Inhalt: der kommt wie eine Webseite und erneuert sich selbst).
// Bei jeder neuen APK hier hochzählen, dazu versionCode/versionName in android/app/build.gradle, `?v=` in
// android/…/strings.xml und den Dateinamen in web/public/_headers. Server und App lesen beide diese Datei:
// die App erfährt beim Abholen der Mitteilungen, dass es eine neuere gibt, und bietet das Update an.
export const APK = { code: 11, name: "1.10" };
/** Ab dieser Version aktualisiert sich die App selbst (crate://update), vorher nur über die geladene Datei */
export const APK_SELF_UPDATE_FROM = 11;
