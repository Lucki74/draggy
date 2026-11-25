---
title: "Image generation"
description: "Draw pictures on your computer: the command, the model, and the size."
section: use
---

## Draw a picture

Type `/image` followed by what you want, or ask for a picture in a chat. Draggy draws it on your computer with a local image engine, so nothing is sent anywhere. A cloud image model sends the prompt to that provider. In a [project](doc:projects) the file is saved under `assets/generated`. Outside a project it goes to your created files.

## Get an image model

Open **Settings → Models** and download an image model like any other. Installed image models show an image icon beside the name, and the quantization sits in the line below. A model the app cannot run yet, such as speech recognition or text to speech, is not offered for download.

## Choose the model and the size

**Settings → Models → Image generation** has two settings:

- **Image model**: Automatic, or one of the image models you have installed, or a cloud image model from a provider you have connected.
- **Image resolution**: the size every picture is drawn at.

| Shape | Sizes |
| --- | --- |
| 1:1 | 512 &times; 512, 768 &times; 768, 1024 &times; 1024 |
| 16:9 | 1024 &times; 576, 1344 &times; 768, 1792 &times; 1024 |
| 9:16 | 576 &times; 1024, 768 &times; 1344, 1024 &times; 1792 |

The model in use carries a yellow **Images** tag in the installed list. Larger sizes take longer and need more memory.

## Pictures in answers

Answers show generated or web-found pictures. Click one to open it in the image viewer.
