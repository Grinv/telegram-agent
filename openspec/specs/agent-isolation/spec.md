## Purpose

Defines the boundary the whole agent runs inside — which directories it can see, which hosts it can reach, and where its credentials live — so that least privilege is enforced by the platform rather than by the agent's own good behaviour.

## Requirements

### Requirement: The agent runs inside a hardware-isolated boundary
The system SHALL run the agent process, its container runtime, and every sandbox it spawns inside a single isolation boundary enforced by hardware virtualization, so that a compromise of the agent cannot reach the host operating system.

The boundary SHALL be disposable: destroying it SHALL leave no agent-created state on the host outside of directories that were explicitly granted.

#### Scenario: Agent process runs inside the boundary
- **WHEN** the agent is started under the isolated deployment
- **THEN** the agent process runs inside the isolation boundary, and no agent process runs directly on the host

#### Scenario: Tool sandboxes run inside the boundary
- **WHEN** the agent executes a tool call
- **THEN** the sandbox container for that call is created by the container runtime inside the boundary, not by the host's container runtime

#### Scenario: Destroying the boundary leaves no residue
- **WHEN** the isolation boundary is destroyed
- **THEN** no containers, images, or writable state created by the agent remain on the host, apart from the contents of explicitly granted read-write directories

### Requirement: Outbound network access is default-deny
The system SHALL deny all outbound network traffic from inside the boundary by default, and SHALL permit traffic only to hosts that have been explicitly allowed. An allow rule SHALL be scopeable to a single boundary rather than applying to every boundary on the machine.

A request to a host that has not been allowed SHALL fail without reaching that host.

#### Scenario: Unallowed host is refused
- **WHEN** a process inside the boundary requests a host that appears in no allow rule
- **THEN** the request fails and the host is not contacted

#### Scenario: Allowed host is reachable
- **WHEN** a host has been explicitly allowed for this boundary and a process inside requests it
- **THEN** the request reaches that host and its response is returned

#### Scenario: Allow rules do not leak between boundaries
- **WHEN** a host is allowed for one boundary and a process in a different boundary requests that host
- **THEN** the request fails, because the rule was scoped to the first boundary

### Requirement: Host services are reachable only when explicitly granted
The system SHALL treat services listening on the host machine the same as any other network destination: unreachable by default, and reachable only after an explicit grant naming that service's port.

A grant for one host port SHALL NOT make other host ports reachable.

#### Scenario: Host service is refused without a grant
- **WHEN** a service is listening on the host machine and no grant names its port, and a process inside the boundary requests it
- **THEN** the request fails and the service is not contacted

#### Scenario: Host service is reachable after a grant
- **WHEN** a service listening on the host machine has been granted by port, and a process inside the boundary requests it
- **THEN** the request reaches the service and its response is returned

#### Scenario: A grant does not open other host ports
- **WHEN** one host port has been granted and a process inside the boundary requests a different host port
- **THEN** that request fails

### Requirement: Only explicitly granted directories are visible
The system SHALL expose to the agent only those host directories that were named when the boundary was created, and SHALL apply the access mode declared for each one. A directory granted read-only SHALL NOT be writable from inside.

Host directories that were not named SHALL NOT be readable or writable from inside the boundary.

#### Scenario: Granted directory is available
- **WHEN** a host directory is granted read-write and the agent reads and writes a file in it
- **THEN** both operations succeed and the changes are visible on the host

#### Scenario: Read-only grant cannot be written
- **WHEN** a host directory is granted read-only and the agent attempts to write to it
- **THEN** the write fails and the host directory is unchanged

#### Scenario: Ungranted directory is invisible
- **WHEN** the agent attempts to read a host directory that was not granted
- **THEN** the read fails and the directory's contents are not disclosed

### Requirement: Credentials are not present inside the boundary
The system SHALL supply the agent's credentials by attaching them to outbound requests to the hosts each credential is bound to, and SHALL NOT place credential values in the environment, filesystem, or configuration visible inside the boundary.

A credential SHALL be bound to the hosts it may be used with, and SHALL NOT be attached to requests to any other host.

Where a credential is held outside the boundary on the agent's behalf, that holder SHALL expose only the operations the agent actually uses, so that holding the credential outside does not grant more than the agent already has.

#### Scenario: Agent authenticates without holding the credential
- **WHEN** the agent makes a request to a host that one of its credentials is bound to
- **THEN** the request is authenticated, and the credential value never appeared inside the boundary

#### Scenario: Credential is not readable from inside
- **WHEN** a process inside the boundary inspects its environment, filesystem, and configuration
- **THEN** no credential value is found

#### Scenario: Credential is not sent to an unbound host
- **WHEN** a request is made to an allowed host that a credential is not bound to
- **THEN** that credential is not attached to the request

#### Scenario: Credential holder refuses operations the agent does not use
- **WHEN** a process inside the boundary asks the credential holder for an API operation that is not one the agent uses
- **THEN** the request is refused and the credential is not used for it

### Requirement: The agent does not run with host administrative rights
The system SHALL run the agent inside the boundary as an unprivileged user, not as the boundary's administrative user.

#### Scenario: Agent runs unprivileged
- **WHEN** the agent process is inspected inside the boundary
- **THEN** it is running as an unprivileged user account
