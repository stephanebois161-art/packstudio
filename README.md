# PackStudio

Concevez votre emballage en 3D (boîte pliante, sac, coffret, présentoir), téléchargez la maquette et demandez un devis.

## Lancer le site sur votre ordinateur

```bash
npm install
npm run dev
```

Puis ouvrez http://localhost:5173

## Mise en ligne

Chaque envoi sur la branche `main` construit le site et le publie sur GitHub Pages
(fichier `.github/workflows/deploy.yml`). Dans le dépôt, réglez une fois
**Settings → Pages → Source : GitHub Actions**.

## Limites actuelles

- Le formulaire de devis n'envoie encore rien.
- L'épaisseur du carton n'est pas représentée en 3D.
