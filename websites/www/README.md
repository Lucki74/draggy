# draggy.org

This folder is the website for Draggy, the free and open source desktop app that runs models on your own computer. The app itself lives at the root of [Lucki74/draggy](https://github.com/Lucki74/draggy).

It is published at https://draggy.org in English, French, Spanish and Russian.

The source of [docs.draggy.org](https://docs.draggy.org) is in [websites/docs](https://github.com/Lucki74/draggy/tree/main/websites/docs).

## Run it

```bash
npm ci
npm run build
npm test
```

Serve `public/` on any static server, for example `python -m http.server 4173 -d public`.

## Contributing

Fixes to wording, translations and out of date content are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache 2.0. See [LICENSE](LICENSE).
