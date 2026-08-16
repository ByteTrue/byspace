#ifndef BYSPACE_TUNNEL_PROTOCOL_H
#define BYSPACE_TUNNEL_PROTOCOL_H

#include <stddef.h>
#include <stdint.h>

#define BYSPACE_TUNNEL_HEADER_SIZE 16
#define BYSPACE_TUNNEL_START_PAYLOAD_SIZE 12
#define BYSPACE_TUNNEL_MAX_PAYLOAD_SIZE 256
#define BYSPACE_TUNNEL_READY_PAYLOAD_SIZE 20

#define BYSPACE_TUNNEL_VERSION 1
#define BYSPACE_TUNNEL_OPCODE_START 1
#define BYSPACE_TUNNEL_OPCODE_STOP 2
#define BYSPACE_TUNNEL_OPCODE_READY 0x81
#define BYSPACE_TUNNEL_OPCODE_STOPPED 0x82
#define BYSPACE_TUNNEL_OPCODE_ERROR 0xff

#define BYSPACE_TUNNEL_OVERLAY_PREFIX 0x0afd0000U
#define BYSPACE_TUNNEL_OVERLAY_MASK 0xffff0000U
#define BYSPACE_TUNNEL_LOCAL_IPV4 0x0afd0001U
#define BYSPACE_TUNNEL_FIRST_PEER_IPV4 0x0afd0002U
#define BYSPACE_TUNNEL_LAST_PEER_IPV4 0x0afdfffeU

struct BySpaceTunnelRequest {
    uint8_t opcode;
    uint32_t local_ipv4;
    uint32_t peer_ipv4;
    uint16_t socks_port;
    uint16_t mtu;
};

uint32_t byspace_tunnel_payload_length(const uint8_t *header);
int byspace_tunnel_decode_request(const uint8_t *frame, size_t frame_length,
                                  struct BySpaceTunnelRequest *request,
                                  char *error, size_t error_size);
size_t byspace_tunnel_encode_frame(uint8_t opcode, const uint8_t *payload,
                                   uint32_t payload_length, uint8_t *frame,
                                   size_t frame_capacity);

#endif
