#include "byspace-tunnel-protocol.h"

#include <arpa/inet.h>
#include <assert.h>
#include <string.h>

static void encode_start(uint8_t *frame, size_t *length)
{
    uint8_t payload[BYSPACE_TUNNEL_START_PAYLOAD_SIZE];
    uint32_t local = inet_addr("10.253.0.1");
    uint32_t peer = inet_addr("10.253.254.2");

    memcpy(payload, &local, sizeof(local));
    memcpy(payload + 4, &peer, sizeof(peer));
    payload[8] = 0x4a;
    payload[9] = 0x38;
    payload[10] = 0x05;
    payload[11] = 0xdc;
    *length = byspace_tunnel_encode_frame(
        BYSPACE_TUNNEL_OPCODE_START, payload, sizeof(payload), frame,
        BYSPACE_TUNNEL_HEADER_SIZE + BYSPACE_TUNNEL_MAX_PAYLOAD_SIZE);
}

static void set_start_ipv4(uint8_t *frame, size_t offset, const char *address)
{
    uint32_t ipv4 = inet_addr(address);
    memcpy(frame + BYSPACE_TUNNEL_HEADER_SIZE + offset, &ipv4, sizeof(ipv4));
}

static void expect_invalid(uint8_t *frame, size_t length, const char *message)
{
    struct BySpaceTunnelRequest request;
    char error[128];

    assert(byspace_tunnel_decode_request(frame, length, &request, error,
                                         sizeof(error)) != 0);
    assert(strcmp(error, message) == 0);
}

int main(void)
{
    uint8_t frame[BYSPACE_TUNNEL_HEADER_SIZE + BYSPACE_TUNNEL_MAX_PAYLOAD_SIZE];
    struct BySpaceTunnelRequest request;
    char error[128];
    size_t length;

    encode_start(frame, &length);
    assert(length == BYSPACE_TUNNEL_HEADER_SIZE +
                         BYSPACE_TUNNEL_START_PAYLOAD_SIZE);
    assert(byspace_tunnel_decode_request(frame, length, &request, error,
                                         sizeof(error)) == 0);
    assert(request.opcode == BYSPACE_TUNNEL_OPCODE_START);
    assert(request.local_ipv4 == inet_addr("10.253.0.1"));
    assert(request.peer_ipv4 == inet_addr("10.253.254.2"));
    assert(request.socks_port == 19000);
    assert(request.mtu == 1500);

    frame[0] = 'x';
    expect_invalid(frame, length, "invalid frame magic");
    encode_start(frame, &length);
    frame[8] = 2;
    expect_invalid(frame, length, "unsupported protocol version");
    encode_start(frame, &length);
    frame[10] = 1;
    expect_invalid(frame, length, "reserved bytes must be zero");
    encode_start(frame, &length);
    frame[12] = 0;
    frame[13] = 0;
    frame[14] = 0;
    frame[15] = 11;
    expect_invalid(frame, length, "frame length mismatch");
    encode_start(frame, &length);
    frame[12] = 0;
    frame[13] = 0;
    frame[14] = 1;
    frame[15] = 1;
    expect_invalid(frame, length, "payload is too large");

    encode_start(frame, &length);
    memset(frame + BYSPACE_TUNNEL_HEADER_SIZE, 0, 4);
    expect_invalid(frame, length, "invalid local overlay IPv4 address");
    encode_start(frame, &length);
    set_start_ipv4(frame, 0, "127.0.0.1");
    expect_invalid(frame, length, "invalid local overlay IPv4 address");
    encode_start(frame, &length);
    set_start_ipv4(frame, 4, "224.0.0.1");
    expect_invalid(frame, length, "invalid peer overlay IPv4 address");
    encode_start(frame, &length);
    set_start_ipv4(frame, 4, "8.8.8.8");
    expect_invalid(frame, length, "invalid peer overlay IPv4 address");
    encode_start(frame, &length);
    set_start_ipv4(frame, 4, "10.253.0.1");
    expect_invalid(frame, length, "invalid peer overlay IPv4 address");
    encode_start(frame, &length);
    set_start_ipv4(frame, 4, "10.253.255.255");
    expect_invalid(frame, length, "invalid peer overlay IPv4 address");
    encode_start(frame, &length);
    frame[BYSPACE_TUNNEL_HEADER_SIZE + 8] = 0;
    frame[BYSPACE_TUNNEL_HEADER_SIZE + 9] = 0;
    expect_invalid(frame, length, "SOCKS port must be non-zero");
    encode_start(frame, &length);
    frame[BYSPACE_TUNNEL_HEADER_SIZE + 10] = 0x02;
    frame[BYSPACE_TUNNEL_HEADER_SIZE + 11] = 0;
    expect_invalid(frame, length, "MTU must be between 1280 and 9000");

    length = byspace_tunnel_encode_frame(BYSPACE_TUNNEL_OPCODE_STOP, NULL, 0,
                                         frame, sizeof(frame));
    assert(length == BYSPACE_TUNNEL_HEADER_SIZE);
    assert(byspace_tunnel_decode_request(frame, length, &request, error,
                                         sizeof(error)) == 0);
    assert(request.opcode == BYSPACE_TUNNEL_OPCODE_STOP);

    frame[BYSPACE_TUNNEL_HEADER_SIZE] = 1;
    length = byspace_tunnel_encode_frame(
        BYSPACE_TUNNEL_OPCODE_STOP, frame + BYSPACE_TUNNEL_HEADER_SIZE, 1,
        frame, sizeof(frame));
    expect_invalid(frame, length, "stop payload must be empty");
    length = byspace_tunnel_encode_frame(0xff, NULL, 0, frame, sizeof(frame));
    expect_invalid(frame, length, "unsupported request opcode");

    assert(byspace_tunnel_encode_frame(BYSPACE_TUNNEL_OPCODE_START, NULL,
                                       BYSPACE_TUNNEL_MAX_PAYLOAD_SIZE + 1, frame,
                                       sizeof(frame)) == 0);
    assert(byspace_tunnel_encode_frame(BYSPACE_TUNNEL_OPCODE_STOP, NULL, 0,
                                       frame, BYSPACE_TUNNEL_HEADER_SIZE - 1) ==
           0);
    assert(byspace_tunnel_encode_frame(BYSPACE_TUNNEL_OPCODE_ERROR, NULL, 1,
                                       frame, sizeof(frame)) == 0);
    assert(byspace_tunnel_encode_frame(BYSPACE_TUNNEL_OPCODE_STOP, NULL, 0,
                                       NULL, sizeof(frame)) == 0);
    return 0;
}
