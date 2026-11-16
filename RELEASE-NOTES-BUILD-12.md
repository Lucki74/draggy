**Updates**

- Answers can show pictures the agent generated or found on the web, and each one opens in a viewer
- Image generation can use a cloud model from a connected provider, picked in Settings next to the local models
- Voice chat can speak with a cloud voice model and pick its voice
- Statistics price each local turn at the OpenRouter rate of the model it is based on, and break the cost down by model
- The image step in a chat folds into a dropdown once the picture is done
- A message you sent to steer a running answer can be taken back and edited
- Research marks a quote it could not find on the page and lists the sources of each run

**Fixes**

- A cloud model chosen as the default now opens with the app
- A llama.cpp server left over from an earlier run no longer keeps an old context window
- Web search during research waits for a provider to cool down instead of failing with no request
- The browser pane opens when the agent visits a page
- Voice chat no longer stops at "Loading voice model"

**Security**

- A web page the agent reads can no longer reach a service on your computer or local network through a public name that points there
- More kinds of executable files are refused when the agent opens a file, including names that end in a dot, a space or a stream suffix
- A script or installer the agent points to opens in its folder instead of running
