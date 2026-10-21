<div align="center">

<img src="https://termix.site/img/logo.svg" width="120" alt="Termix Logo" />

<h1>Services</h1>

<p>Manage services, timers and logs on your hosts over SSH</p>

<!-- VIDEO:START -->

<a href="https://www.youtube.com/watch?v=uVoLykPpvWk"><img src="https://img.shields.io/badge/Watch_the_demo-f59145?style=for-the-badge&logo=youtube&logoColor=white" alt="Watch the demo on YouTube" /></a>

<!-- VIDEO:END -->

</div>

<br />

## Overview

Services manages systemd services on your hosts over SSH. Each host gets its own tab for services, timers, the journal and log files, and a panel beside the SSH terminal.

Read the [docs](https://docs.termix.site/plugins/service-manager) to set it up and use it.

<br />

## Features

- Start, stop, restart, enable, disable and mask services
- Unit details with memory, CPU, tasks, restarts and recent logs
- Edit unit files and overrides, checked with systemd-analyze first
- Create a new service or scheduled job from a form
- Timers with last and next run, and run now
- Journal by unit, priority, time, boot and text, with live follow
- Browse, search, follow and download files in /var/log
- Alerts when a watched service fails, and when it is back
- Basic OpenRC support

<br />

## Sponsors

For a paid sponsor spot, email [mail@termix.site](mailto:mail@termix.site).

<!-- SPONSORS:START -->

<div align="center">

<br />

<a href="https://www.blacksmith.sh/">
  <img src="https://termix.site/img/sponsors/blacksmith.svg" height="40" alt="Blacksmith" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://www.cloudflare.com/">
  <img src="https://termix.site/img/sponsors/cloudflare.png" height="40" alt="Cloudflare" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://akamai.com/">
  <img src="https://termix.site/img/sponsors/akamai.svg" height="40" alt="Akamai" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://aws.amazon.com/">
  <img src="https://termix.site/img/sponsors/aws.png" height="40" alt="AWS" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://rackgenius.com/">
  <img src="https://termix.site/img/sponsors/rackgenius.png" height="40" alt="Rack Genius" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://ginernet.com/">
  <img src="https://termix.site/img/sponsors/ginernet.png" height="40" alt="Ginernet" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://www.hetzner.com/?mtm_campaign=termix&mtm_medium=referral&mtm_content=sponsoring_link">
  <img src="https://termix.site/img/sponsors/hetzner.png" height="40" alt="Hetzner" />
</a>

</div>

<!-- SPONSORS:END -->

<br />

## Support

Bugs and ideas for Services go in this repo: [report a bug](https://github.com/Termix-SSH/Plugin-Service-Manager/issues/new?template=bug_report.yml) or [request a feature](https://github.com/Termix-SSH/Plugin-Service-Manager/issues/new?template=feature_request.yml). Report an issue on the plugin's page in the Plugins tab fills in your versions for you.

Problems with Termix itself (login, hosts, credentials, sharing, sync) go in the [Termix repo](https://github.com/Termix-SSH/Termix/issues/new/choose). Not sure where it goes? Open it there and it will be moved.

Add as much detail as you can, in English if possible. For questions, join the [Discord](https://discord.gg/jVQGdvHDrf) server.

<br />

## License

Apache License 2.0. See [LICENSE](LICENSE).
