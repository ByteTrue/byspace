#include "byspace-tunnel-protocol.h"

#include <arpa/inet.h>
#include <stdio.h>
#include <string.h>

static const uint8_t frame_magic[8] = {'B', 'Y', 'S', 'P', 'T', 'U', 'N', '1'};

static uint16_t read_u16(const uint8_t *value)
{
    return (uint16_t)(((uint16_t)value[0] << 8) | value[1]);
}

static uint32_t read_u32(const uint8_t *value)
{
    return ((uint32_t)value[0] << 24) | ((uint32_t)value[1] << 16) |
           ((uint32_t)value[2] << 8) | value[3];
}

static void write_u32(uint8_t *output, uint32_t value)
{
    output[0] = (uint8_t)(value >> 24);
    output[1] = (uint8_t)(value >> 16);
    output[2] = (uint8_t)(value >> 8);
    output[3] = (uint8_t)value;
}

static int fail(char *error, size_t error_size, const char *message)
{
    if (error_size > 0) {
        snprintf(error, error_size, "%s", message);
    }
    return -1;
}

uint32_t byspace_tunnel_payload_length(const uint8_t *header)
{
    return read_u32(header + 12);
}

static int is_local_overlay_ipv4(uint32_t address)
{
    return ntohl(address) == BYSPACE_TUNNEL_LOCAL_IPV4;
}

static int is_peer_overlay_ipv4(uint32_t address)
{
    uint32_t host_address = ntohl(address);

    return (host_address & BYSPACE_TUNNEL_OVERLAY_MASK) ==
               BYSPACE_TUNNEL_OVERLAY_PREFIX &&
           host_address >= BYSPACE_TUNNEL_FIRST_PEER_IPV4 &&
           host_address <= BYSPACE_TUNNEL_LAST_PEER_IPV4;
}

int byspace_tunnel_decode_request(const uint8_t *frame, size_t frame_length,
                                  struct BySpaceTunnelRequest *request,
                                  char *error, size_t error_size)
{
    uint32_t payload_length;

    if (frame_length < BYSPACE_TUNNEL_HEADER_SIZE) {
        return fail(error, error_size, "short frame header");
    }
    if (memcmp(frame, frame_magic, sizeof(frame_magic)) != 0) {
        return fail(error, error_size, "invalid frame magic");
    }
    if (frame[8] != BYSPACE_TUNNEL_VERSION) {
        return fail(error, error_size, "unsupported protocol version");
    }
    if (frame[10] != 0 || frame[11] != 0) {
        return fail(error, error_size, "reserved bytes must be zero");
    }

    payload_length = byspace_tunnel_payload_length(frame);
    if (payload_length > BYSPACE_TUNNEL_MAX_PAYLOAD_SIZE) {
        return fail(error, error_size, "payload is too large");
    }
    if (frame_length != BYSPACE_TUNNEL_HEADER_SIZE + payload_length) {
        return fail(error, error_size, "frame length mismatch");
    }

    memset(request, 0, sizeof(*request));
    request->opcode = frame[9];

    if (request->opcode == BYSPACE_TUNNEL_OPCODE_STOP) {
        if (payload_length != 0) {
            return fail(error, error_size, "stop payload must be empty");
        }
        return 0;
    }
    if (request->opcode != BYSPACE_TUNNEL_OPCODE_START) {
        return fail(error, error_size, "unsupported request opcode");
    }
    if (payload_length != BYSPACE_TUNNEL_START_PAYLOAD_SIZE) {
        return fail(error, error_size, "invalid start payload length");
    }

    memcpy(&request->local_ipv4, frame + BYSPACE_TUNNEL_HEADER_SIZE, 4);
    memcpy(&request->peer_ipv4, frame + BYSPACE_TUNNEL_HEADER_SIZE + 4, 4);
    request->socks_port = read_u16(frame + BYSPACE_TUNNEL_HEADER_SIZE + 8);
    request->mtu = read_u16(frame + BYSPACE_TUNNEL_HEADER_SIZE + 10);

    if (!is_local_overlay_ipv4(request->local_ipv4)) {
        return fail(error, error_size, "invalid local overlay IPv4 address");
    }
    if (!is_peer_overlay_ipv4(request->peer_ipv4)) {
        return fail(error, error_size, "invalid peer overlay IPv4 address");
    }
    if (request->socks_port == 0) {
        return fail(error, error_size, "SOCKS port must be non-zero");
    }
    if (request->mtu < 1280 || request->mtu > 9000) {
        return fail(error, error_size, "MTU must be between 1280 and 9000");
    }

    return 0;
}

size_t byspace_tunnel_encode_frame(uint8_t opcode, const uint8_t *payload,
                                   uint32_t payload_length, uint8_t *frame,
                                   size_t frame_capacity)
{
    size_t frame_length = BYSPACE_TUNNEL_HEADER_SIZE + payload_length;

    if (payload_length > BYSPACE_TUNNEL_MAX_PAYLOAD_SIZE ||
        (payload_length > 0 && payload == NULL) || frame == NULL ||
        frame_capacity < frame_length) {
        return 0;
    }

    memcpy(frame, frame_magic, sizeof(frame_magic));
    frame[8] = BYSPACE_TUNNEL_VERSION;
    frame[9] = opcode;
    frame[10] = 0;
    frame[11] = 0;
    write_u32(frame + 12, payload_length);
    if (payload_length > 0 && payload != NULL) {
        memcpy(frame + BYSPACE_TUNNEL_HEADER_SIZE, payload, payload_length);
    }
    return frame_length;
}
