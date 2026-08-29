pub fn encode(value: u8) -> String {
    format!("{value:02x}")
}

#[cfg(test)]
mod tests {
    use super::encode;

    #[test]
    fn encodes_a_byte() {
        assert_eq!(encode(15), "0f");
    }
}
