---
name: social-graphic-spec
description: Produces a per-platform spec sheet for social graphics with sizes, safe zones, text limits and file formats, taken from each platform's current documentation. Use when the user asks what size an image should be, wants a spec for social posts or banners, or needs one design adapted to several channels.
---

# Social graphic spec

## Goal

Give a spec sheet the user can hand to a designer or use directly. Every number is read from a current official source, because platforms change sizes often.

## When to use

- The user needs image sizes for posts, stories, covers, avatars or ads.
- One visual must be adapted to several platforms.
- For the visual direction, use `use_skill` with `moodboard-brief`. For a video or article cover, use `use_skill` with `thumbnail-brief`.

## Steps

1. Ask with `ask_user` which platforms, which formats (feed post, story, cover, avatar, link preview), and whether the graphic will be organic or paid. Ad formats often have extra rules.
2. For each platform and format, find the official help or design page with `search_web`, open it with `read_url`, and copy the recommended size, aspect ratio, maximum file size, accepted formats and text or overlay rules. Record the page address and the date read.
3. If two sources disagree, prefer the platform's own help center and note the conflict. If no official page can be found, say the number is unconfirmed.
4. Define safe zones: where the interface covers the image (profile circle, caption overlay, buttons, rounded corners). Use official guidance when it exists, otherwise state a conservative margin and label it as a recommendation.
5. Plan one master design and its crops. Pick the most demanding format as the master, and mark the focal subject area that must survive every crop.
6. Add handoff notes: color mode, export format and quality, naming scheme such as `campaign_platform_format_v1`, and alt text for each post.
7. Write the sheet with `create_file` as a table, and add a "check again before use" date.
8. Add accessibility fields: alt text guidance, caption text for any spoken content in video, and a contrast target for overlaid text.
9. Plan the refresh: set a reminder for the user to recheck the sizes before each new campaign, since the sources can change.

## Gotchas

- Sizes from an old blog post are often wrong. Read the platform's page and note the date.
- Compression on upload softens text. Keep type large and test with an actual upload to a private account.
- Cropping a landscape master to vertical without a plan cuts off faces and logos.
- Text-heavy images may reduce ad delivery on some platforms. Check the ad policy page for the current rule.
- Stories and reels have top and bottom UI areas that cover content, and these zones differ by app.
- Profile images are cropped to a circle or rounded square on some platforms and not on others. Keep the subject centered.
- Animated formats have their own length, frame rate and size limits. Look them up separately.

## Output

- Alt text guidance and the recheck date at the end of the sheet.
- A table per platform: format, size, ratio, safe zone, file limits, source link.
- A master and crop plan in a few lines.
- A list of unconfirmed values and the date each was checked.
