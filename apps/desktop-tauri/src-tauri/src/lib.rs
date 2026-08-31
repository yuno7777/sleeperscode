use std::net::IpAddr;

use tauri::Url;

pub const DEVELOPMENT_URL_ENV: &str = "SLEEPERS_CODE_TAURI_URL";

#[derive(Debug, PartialEq, Eq)]
pub enum DevelopmentUrlError {
    Missing,
    Invalid,
    UnsupportedScheme,
    CredentialsNotAllowed,
    NonLoopbackHost,
}

pub fn development_url(value: Option<&str>) -> Result<Url, DevelopmentUrlError> {
    let value = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(DevelopmentUrlError::Missing)?;
    let url = Url::parse(value).map_err(|_| DevelopmentUrlError::Invalid)?;

    if !matches!(url.scheme(), "http" | "https") {
        return Err(DevelopmentUrlError::UnsupportedScheme);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(DevelopmentUrlError::CredentialsNotAllowed);
    }

    let is_loopback = match url.host_str() {
        Some("localhost") => true,
        Some(host) => host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback()),
        None => false,
    };
    if !is_loopback {
        return Err(DevelopmentUrlError::NonLoopbackHost);
    }

    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_loopback_web_origins_and_preserves_pairing_data() {
        let url = development_url(Some(" http://127.0.0.1:5733/?pair=token#thread ")).unwrap();

        assert_eq!(url.host_str(), Some("127.0.0.1"));
        assert_eq!(url.query(), Some("pair=token"));
        assert_eq!(url.fragment(), Some("thread"));
    }

    #[test]
    fn rejects_remote_hosts_credentials_and_non_web_schemes() {
        assert_eq!(
            development_url(Some("https://app.t3.codes")),
            Err(DevelopmentUrlError::NonLoopbackHost)
        );
        assert_eq!(
            development_url(Some("http://user:secret@localhost:5733")),
            Err(DevelopmentUrlError::CredentialsNotAllowed)
        );
        assert_eq!(
            development_url(Some("file:///C:/Windows/System32")),
            Err(DevelopmentUrlError::UnsupportedScheme)
        );
    }

    #[test]
    fn requires_an_explicit_url() {
        assert_eq!(development_url(None), Err(DevelopmentUrlError::Missing));
        assert_eq!(
            development_url(Some("  ")),
            Err(DevelopmentUrlError::Missing)
        );
    }
}
