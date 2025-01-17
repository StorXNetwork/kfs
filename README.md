KFS (Kademlia File Store)
=========================

The KFS system describes a method for managing the storage layer of nodes on 
the [StorX Network](https://StorX.io) by creating a sharded local database 
where content-addressable data is placed in a shard using the same routing 
metric and algorithm used by the Kademlia distributed hash table.

Quick Start
-----------

Install the `kfs` package using [Node Package Manager].

```
npm install kfs --save
```

```
const kfs = require('kfs');
const store = kfs('path/to/store');

store.writeFile('some key', Buffer.from('some data'), (err) => {
  console.log(err || 'File written to store!');
});
```

License
-------

KFS - A Local File Storage System Inspired by Kademlia  
Copyright (C) 2016 Storj Labs, Inc

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see [http://www.gnu.org/licenses/].

[Kademlia]: https://en.wikipedia.org/wiki/Kademlia "Kademlia"
[Storj Network]: https://storj.io "Storj Labs"
[LevelDB]: http://leveldb.org/ "LevelDB"
[distance]: https://en.wikipedia.org/wiki/Kademlia#Routing_tables
[Node Package Manager]: https://npmjs.org "Node Package Manager"
[documentation]: http://bookch.in/kfs/ "Package Documentation"
