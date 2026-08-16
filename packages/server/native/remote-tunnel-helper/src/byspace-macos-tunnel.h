#ifndef BYSPACE_MACOS_TUNNEL_H
#define BYSPACE_MACOS_TUNNEL_H

#include <net/if.h>
#include <stddef.h>
#include <stdint.h>

struct BySpaceMacosTunnel {
    int fd;
    int route_added;
    uint32_t peer_ipv4;
    char interface_name[IFNAMSIZ];
};

int byspace_macos_tunnel_open(struct BySpaceMacosTunnel *tunnel,
                              uint32_t local_ipv4, uint32_t peer_ipv4,
                              uint16_t mtu, char *error, size_t error_size);
int byspace_macos_tunnel_close(struct BySpaceMacosTunnel *tunnel);

#endif
