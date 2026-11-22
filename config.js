// Adresse du backend Google Apps Script (déploiement « Application Web », se termine par /exec).
// Laisser vide = mode démo : les saisies restent sur le téléphone, rien n'est envoyé.
// « self » = la page (window) ou le service worker, qui lit aussi ce fichier.
self.PHENIX_API = "https://script.google.com/macros/s/AKfycbzoq8qBnNCiLLNKd7JBVMuzlIssko_JyIKNqSYE-mUFUnlGgmGsF4yc72SxESskOq4NNQ/exec";
// Clé publique des notifications (la clé privée est seulement dans le backend Google)
self.PHENIX_VAPID = "BIL_CPd3y-nIsijougxSo03gQqEis8yRQ-K0B6Bt4w9uNRSBsYSJSr3iEuz-REhWf2qQDuJjhxJGEDSsjvAAa-8";
