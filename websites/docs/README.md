# docs.draggy.org

This folder is the documentation for Draggy, the free and open source desktop app that runs models on your own computer. The app itself lives at the root of [Lucki74/draggy](https://github.com/Lucki74/draggy).

It is published at https://docs.draggy.org in English, French, Spanish and Russian.

The source of [draggy.org](https://draggy.org) is in [websites/www](https://github.com/Lucki74/draggy/tree/main/websites/www).

## Run it

```bash
npm ci
npm run build
npm test
```

Serve `public/` on any static server, for example `python -m http.server 4174 -d public`.

## Contributing

Fixes to wording, translations and out of date content are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache 2.0. See [LICENSE](LICENSE).
